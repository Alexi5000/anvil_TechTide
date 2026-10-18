#[path = "../src/profile_flamegraph.rs"]
mod profile_flamegraph;

#[test]
fn profile_formats_preserve_samples_and_propagate_write_errors() {
    use pprof::protos::Message;
    use std::time::{Duration, Instant, SystemTime};

    let guard = pprof::ProfilerGuardBuilder::default()
        .frequency(997)
        .build()
        .unwrap();
    let started = Instant::now();
    let mut value = 1u64;
    while started.elapsed() < Duration::from_millis(250) {
        value = std::hint::black_box(value.wrapping_mul(3).wrapping_add(1));
    }
    let mut report = guard.report().build().unwrap();
    assert!(
        !report.data.is_empty(),
        "CPU sampling must collect real frames"
    );
    let mut sampled_svg = Vec::new();
    profile_flamegraph::write_flamegraph(&report, &mut sampled_svg).unwrap();
    assert!(String::from_utf8(sampled_svg).unwrap().contains("<svg"));
    let encoded = report.pprof().unwrap().encode_to_vec();
    let decoded = pprof::protos::Profile::decode(encoded.as_slice()).unwrap();
    assert!(!decoded.sample.is_empty());

    report.data.clear();
    let mut empty = Vec::new();
    profile_flamegraph::write_flamegraph(&report, &mut empty).unwrap();
    assert!(empty.is_empty());

    let symbol = |name: &str| pprof::Symbol {
        name: Some(name.as_bytes().to_vec()),
        addr: None,
        lineno: None,
        filename: None,
    };
    report.data.insert(
        pprof::Frames {
            frames: vec![vec![symbol("leaf<&>")], vec![symbol("root")]],
            thread_name: "worker<&>".into(),
            thread_id: 7,
            sample_timestamp: SystemTime::now(),
        },
        42,
    );
    let mut output = Vec::new();
    profile_flamegraph::write_flamegraph(&report, &mut output).unwrap();
    let svg = String::from_utf8(output).unwrap();
    assert!(svg.contains("42 samples"));
    assert!(svg.contains("leaf&lt;&amp;&gt;"));
    assert!(svg.contains("worker&lt;&amp;&gt;"));

    struct FailedWriter;
    impl std::io::Write for FailedWriter {
        fn write(&mut self, _: &[u8]) -> std::io::Result<usize> {
            Err(std::io::Error::other("simulated disk failure"))
        }
        fn flush(&mut self) -> std::io::Result<()> {
            Ok(())
        }
    }
    assert!(profile_flamegraph::write_flamegraph(&report, FailedWriter).is_err());
}
