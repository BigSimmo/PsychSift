import { WorkTag } from "@/components/mode-kit/work";

/**
 * The small amber "Example" tag for a card or hero that shows a made-up
 * record. A word, never colour alone, and read out as "Example record".
 */
export function ExampleTag() {
  return (
    <span role="img" aria-label="Example record" className="inline-flex flex-none">
      <WorkTag tone="amber">Example</WorkTag>
    </span>
  );
}
