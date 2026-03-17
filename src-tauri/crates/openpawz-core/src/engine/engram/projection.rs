// ── Engram: Dimensionality Reduction for Embedding Visualization ────────────
//
// Lightweight server-side projection of high-dimensional embedding vectors
// into 2D/3D coordinates for the Memory Atlas scatter plot.
//
// Algorithm: Iterative PCA via power iteration — no external deps needed.
// We center the data, then extract the top 3 principal components.
//
// For small datasets (< 5000) this runs in milliseconds.

/// A projected point for frontend consumption.
#[derive(Debug, Clone, serde::Serialize)]
pub struct ProjectedPoint {
    pub id: String,
    pub x: f32,
    pub y: f32,
    pub z: f32,
}

/// Project high-dimensional vectors to 3D using PCA (power iteration).
///
/// Returns one `ProjectedPoint` per input `(id, vector)`.
/// The output coordinates are normalized to roughly [-1, 1].
pub fn project_to_3d(vectors: &[(String, Vec<f32>)]) -> Vec<ProjectedPoint> {
    if vectors.is_empty() {
        return Vec::new();
    }

    let n = vectors.len();
    let d = vectors[0].1.len();

    if d == 0 {
        return vectors
            .iter()
            .map(|(id, _)| ProjectedPoint {
                id: id.clone(),
                x: 0.0,
                y: 0.0,
                z: 0.0,
            })
            .collect();
    }

    // Step 1: Compute mean vector
    let mut mean = vec![0.0f64; d];
    for (_, v) in vectors {
        for (i, &val) in v.iter().enumerate() {
            if i < d {
                mean[i] += val as f64;
            }
        }
    }
    let n_f = n as f64;
    for m in &mut mean {
        *m /= n_f;
    }

    // Step 2: Center the data (keep as f64 for precision)
    let centered: Vec<Vec<f64>> = vectors
        .iter()
        .map(|(_, v)| {
            v.iter()
                .enumerate()
                .map(|(i, &val)| val as f64 - mean.get(i).copied().unwrap_or(0.0))
                .collect()
        })
        .collect();

    // Step 3: Extract top 3 principal components via power iteration
    let components = extract_principal_components(&centered, d, 3);

    // Step 4: Project each centered vector onto the 3 components
    let mut points: Vec<ProjectedPoint> = Vec::with_capacity(n);
    for (idx, (id, _)) in vectors.iter().enumerate() {
        let row = &centered[idx];
        let x = dot_product(row, &components[0]);
        let y = dot_product(row, &components[1]);
        let z = dot_product(row, &components[2]);
        points.push(ProjectedPoint {
            id: id.clone(),
            x: x as f32,
            y: y as f32,
            z: z as f32,
        });
    }

    // Step 5: Normalize to [-1, 1] range
    normalize_points(&mut points);

    points
}

/// Extract `k` principal components via deflated power iteration.
fn extract_principal_components(centered: &[Vec<f64>], d: usize, k: usize) -> Vec<Vec<f64>> {
    let mut components = Vec::with_capacity(k);
    let mut residual: Vec<Vec<f64>> = centered.to_vec();

    for _ in 0..k {
        let pc = power_iteration(&residual, d, 100);

        // Deflate: remove this component's contribution from the data
        for row in &mut residual {
            let proj = dot_product(row, &pc);
            for (j, val) in row.iter_mut().enumerate() {
                *val -= proj * pc[j];
            }
        }

        components.push(pc);
    }

    // Safety: if we got fewer than k (impossible in practice), pad with zeros
    while components.len() < k {
        components.push(vec![0.0; d]);
    }

    components
}

/// Single principal component via power iteration (dominant eigenvector of X^T X).
fn power_iteration(data: &[Vec<f64>], d: usize, max_iters: usize) -> Vec<f64> {
    if data.is_empty() || d == 0 {
        return vec![0.0; d.max(1)];
    }

    // Initialize with a deterministic non-zero vector
    let mut v: Vec<f64> = (0..d).map(|i| (i as f64 + 1.0).sin()).collect();
    let norm = vector_norm(&v);
    if norm > 1e-12 {
        for x in &mut v {
            *x /= norm;
        }
    }

    for _ in 0..max_iters {
        // w = X^T * (X * v)
        // First: compute Xv (n-dim vector of projections)
        let xv: Vec<f64> = data.iter().map(|row| dot_product(row, &v)).collect();

        // Then: X^T * xv (d-dim vector)
        let mut w = vec![0.0f64; d];
        for (i, row) in data.iter().enumerate() {
            for (j, &val) in row.iter().enumerate() {
                w[j] += val * xv[i];
            }
        }

        // Normalize
        let norm = vector_norm(&w);
        if norm < 1e-12 {
            break;
        }
        for x in &mut w {
            *x /= norm;
        }

        v = w;
    }

    v
}

fn dot_product(a: &[f64], b: &[f64]) -> f64 {
    a.iter().zip(b.iter()).map(|(x, y)| x * y).sum()
}

fn vector_norm(v: &[f64]) -> f64 {
    dot_product(v, v).sqrt()
}

/// Normalize projected points to [-1, 1] range per axis.
fn normalize_points(points: &mut [ProjectedPoint]) {
    if points.is_empty() {
        return;
    }

    let mut min_x = f32::MAX;
    let mut max_x = f32::MIN;
    let mut min_y = f32::MAX;
    let mut max_y = f32::MIN;
    let mut min_z = f32::MAX;
    let mut max_z = f32::MIN;

    for p in points.iter() {
        min_x = min_x.min(p.x);
        max_x = max_x.max(p.x);
        min_y = min_y.min(p.y);
        max_y = max_y.max(p.y);
        min_z = min_z.min(p.z);
        max_z = max_z.max(p.z);
    }

    let range_x = (max_x - min_x).max(1e-6);
    let range_y = (max_y - min_y).max(1e-6);
    let range_z = (max_z - min_z).max(1e-6);

    for p in points.iter_mut() {
        p.x = (p.x - min_x) / range_x * 2.0 - 1.0;
        p.y = (p.y - min_y) / range_y * 2.0 - 1.0;
        p.z = (p.z - min_z) / range_z * 2.0 - 1.0;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_empty_input() {
        let result = project_to_3d(&[]);
        assert!(result.is_empty());
    }

    #[test]
    fn test_single_point() {
        let vecs = vec![("a".into(), vec![1.0, 2.0, 3.0, 4.0])];
        let result = project_to_3d(&vecs);
        assert_eq!(result.len(), 1);
        assert_eq!(result[0].id, "a");
    }

    #[test]
    fn test_two_opposite_points() {
        let vecs = vec![
            ("a".into(), vec![1.0, 0.0, 0.0, 0.0]),
            ("b".into(), vec![-1.0, 0.0, 0.0, 0.0]),
        ];
        let result = project_to_3d(&vecs);
        assert_eq!(result.len(), 2);
        // They should be at opposite ends of the x axis
        assert!((result[0].x - (-result[1].x)).abs() < 0.01);
    }

    #[test]
    fn test_cluster_separation() {
        // Two clusters in 8-dim space that should separate in projection
        let mut vecs: Vec<(String, Vec<f32>)> = Vec::new();
        for i in 0..10 {
            vecs.push((
                format!("a{}", i),
                vec![1.0, 1.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0],
            ));
        }
        for i in 0..10 {
            vecs.push((
                format!("b{}", i),
                vec![0.0, 0.0, 0.0, 0.0, 1.0, 1.0, 0.0, 0.0],
            ));
        }
        let result = project_to_3d(&vecs);
        assert_eq!(result.len(), 20);

        // First cluster should have similar x coordinates
        let a_xs: Vec<f32> = result[..10].iter().map(|p| p.x).collect();
        let b_xs: Vec<f32> = result[10..].iter().map(|p| p.x).collect();
        let a_mean: f32 = a_xs.iter().sum::<f32>() / 10.0;
        let b_mean: f32 = b_xs.iter().sum::<f32>() / 10.0;
        // Clusters should be separated
        assert!((a_mean - b_mean).abs() > 0.1);
    }

    #[test]
    fn test_normalization_range() {
        let vecs: Vec<(String, Vec<f32>)> = (0..50)
            .map(|i| {
                (
                    format!("p{}", i),
                    (0..16).map(|j| ((i * 7 + j * 3) as f32).sin()).collect(),
                )
            })
            .collect();
        let result = project_to_3d(&vecs);

        for p in &result {
            assert!(p.x >= -1.01 && p.x <= 1.01);
            assert!(p.y >= -1.01 && p.y <= 1.01);
            assert!(p.z >= -1.01 && p.z <= 1.01);
        }
    }
}
