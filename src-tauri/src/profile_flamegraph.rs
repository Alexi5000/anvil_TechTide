use std::io::Write;

pub fn write_flamegraph(report: &pprof::Report, writer: impl Write) -> std::io::Result<()> {
    let stacks: Vec<String> = report
        .data
        .iter()
        .map(|(frames, count)| {
            let mut names = vec![frames.thread_name_or_id()];
            names.extend(
                frames
                    .frames
                    .iter()
                    .rev()
                    .flat_map(|frame| frame.iter().rev().map(ToString::to_string)),
            );
            format!("{} {}", names.join(";"), count)
        })
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
