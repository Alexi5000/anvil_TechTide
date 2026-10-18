use std::io::Write;

fn folded_stack(frames: &pprof::Frames, count: isize) -> String {
    let mut names = vec![frames.thread_name_or_id()];
    names.extend(
        frames
            .frames
            .iter()
            .rev()
            .flat_map(|frame| frame.iter().rev().map(ToString::to_string)),
    );
    format!("{} {}", names.join(";"), count)
}

pub fn write_flamegraph(report: &pprof::Report, writer: impl Write) -> std::io::Result<()> {
    let stacks: Vec<String> = report
        .data
        .iter()
        .map(|(frames, count)| folded_stack(frames, *count))
        .collect();
    if stacks.is_empty() {
        return Ok(());
    }
    inferno::flamegraph::from_lines(
        &mut inferno::flamegraph::Options::default(),
        stacks.iter().map(String::as_str),
        writer,
    )
}

#[cfg(test)]
mod tests {
    #[test]
    fn preserves_inline_stack_order_unicode_and_unnamed_threads() {
        let symbol = |name: &str| pprof::Symbol {
            name: Some(name.as_bytes().to_vec()),
            addr: None,
            lineno: None,
            filename: None,
        };
        let mut frames = pprof::Frames {
            frames: vec![vec![symbol("leaf"), symbol("inline")], vec![symbol("根")]],
            thread_name: "作業".into(),
            thread_id: 7,
            sample_timestamp: std::time::SystemTime::now(),
        };
        assert_eq!(super::folded_stack(&frames, 42), "作業;根;inline;leaf 42");
        frames.thread_name.clear();
        assert_eq!(super::folded_stack(&frames, 42), "7;根;inline;leaf 42");
    }
}
