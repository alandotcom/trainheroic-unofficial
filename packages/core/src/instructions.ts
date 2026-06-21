/**
 * Server-level guidance passed as the MCP `instructions` string. The host model receives it
 * in the initialize result and treats it like a system hint. Its job is to stop tool-layer
 * implementation details from leaking into user-facing replies: by default a model narrates
 * capability using the raw snake_case tool name (e.g. `athlete_session_create`), and the tool
 * descriptions here reference each other by name to drive correct chaining, which primes that
 * leak further. This tells the host to keep that wiring internal and speak in app terms.
 */
export const SERVER_INSTRUCTIONS =
  "Speak to the user in plain, everyday language about their training. Describe what you are " +
  "doing in the TrainHeroic app's own terms (for example, say you are creating a workout rather " +
  "than naming a tool). Do not surface internal tool names (the snake_case identifiers such as " +
  "athlete_session_create), raw parameter names, or numeric ids in your replies unless the user " +
  "explicitly asks for them; they are implementation details. The tool descriptions cross-reference " +
  "each other by name only so you can chain them correctly. Keep that wiring to yourself.";
