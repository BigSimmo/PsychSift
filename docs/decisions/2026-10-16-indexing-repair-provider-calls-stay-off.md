# Decision: The indexing repair job keeps its provider calls off until the safety scanner is connected

- **Status:** decided 2026-10-16
- **Source:** the owner, in chat

The nightly indexing repair job added in PR 3546 cannot call OpenAI because its safety scanner is not connected, so repairs that need a provider pause rather than finish. The owner chose to leave this as it is for now.

If this summary and the source ever differ, the source wins.
