// Multi-line code snippets for the Starlight docs pages. They live in a .ts
// module because MDX strips the JSX element's indentation from template
// literals written inline in component attributes, which mangles the
// rendered code.
import { MCP_URL, NPM_ATHLETE_MCP, NPM_CLI, NPM_COACH_MCP, NPM_JS } from "./tools";

export const SDK_COACH_WORKFLOW = `import {
  TrainHeroicClient,
  ExerciseLibrary,
  buildSession,
  fetchCoachRoster,
} from "${NPM_JS}";
import { JsonFileLibraryCache } from "${NPM_JS}/node";

const client = new TrainHeroicClient(email, password);
const library = new ExerciseLibrary(client, new JsonFileLibraryCache());

for (const athlete of await fetchCoachRoster(client)) {
  console.log(athlete.name, athlete.id);
}

const { match } = await library.resolve("Back Squat");
if (!match) throw new Error("Resolve to one exercise first");

const { pwId } = await buildSession(client, {
  programId: 12345, // from list_teams → group_program
  date: [2026, 6, 22],
  blocks: [{
    title: "Strength",
    exercises: [{ id: match.id, sets: 5, reps: 5, weight: 225, rpe: 8 }],
  }],
  publish: false,
});`;

export const SDK_ATHLETE_READS = `import {
  TrainHeroicClient,
  resolveAthleteUserId,
  fetchAthleteProfileSummary,
  searchExerciseHistory,
  fetchExerciseHistoryDetail,
  fetchPersonalRecords,
} from "${NPM_JS}";

const client = new TrainHeroicClient(email, password);
const userId = await resolveAthleteUserId(client);

const profile = await fetchAthleteProfileSummary(client, userId);
console.log(profile.volume_sum);

const [squat] = await searchExerciseHistory(client, "back squat", 1);
if (squat) {
  const id = Number(squat.id);
  console.log(await fetchExerciseHistoryDetail(client, id, userId));
  console.log(await fetchPersonalRecords(client, id));
}`;

export const SDK_ANALYTICS = `import {
  TrainHeroicClient,
  analyticsMetricCatalog,
  queryAnalytics,
} from "${NPM_JS}";

const client = new TrainHeroicClient(email, password);

// Read-only report (TrainHeroic uses POST for these queries).
const readiness = await queryAnalytics(client, {
  metric: "readiness-team",
  teamId: 42,
  date: "2026-06-22",
});
console.log(readiness);

// Scope + required params for every metric key:
console.log(analyticsMetricCatalog());`;

export const SDK_MESSAGING = `import {
  TrainHeroicClient,
  fetchStreams,
  sendComment,
} from "${NPM_JS}";

const client = new TrainHeroicClient(email, password);

const team = (await fetchStreams(client)).find((s) => s.kind === "team");
if (team && typeof team.stream.id === "number") {
  const comment = await sendComment(client, team.stream.id, "Great week.");
  console.log(comment);
}`;

export const HOME_PROMPTS = `List my athletes
What's on the program for Tuesday?
Show my squat PRs this year
Draft a back squat workout for next Monday`;

export const MCP_CLIENT_CONFIG = `{
  "mcpServers": {
    "trainheroic": {
      "url": "${MCP_URL}"
    }
  }
}`;

export const MCP_COACH_ADD = `claude mcp add trainheroic \\
  -e TRAINHEROIC_EMAIL=coach@example.com \\
  -e TRAINHEROIC_PASSWORD=yourpassword \\
  -- npx -y ${NPM_COACH_MCP}`;

export const MCP_COACH_CONFIG = `{
  "mcpServers": {
    "trainheroic": {
      "command": "npx",
      "args": ["-y", "${NPM_COACH_MCP}"],
      "env": {
        "TRAINHEROIC_EMAIL": "coach@example.com",
        "TRAINHEROIC_PASSWORD": "yourpassword"
      }
    }
  }
}`;

export const MCP_ATHLETE_ADD = `claude mcp add trainheroic-athlete \\
  -e TRAINHEROIC_EMAIL=athlete@example.com \\
  -e TRAINHEROIC_PASSWORD=yourpassword \\
  -- npx -y ${NPM_ATHLETE_MCP}`;

export const SKILL_INSTALL_CLI = `npm install -g ${NPM_CLI}
trainheroic install-skill`;

export const SKILL_CREDENTIALS = `export TRAINHEROIC_EMAIL=coach@example.com
export TRAINHEROIC_PASSWORD=yourpassword`;

export const SKILL_CLI_TOUR = `trainheroic whoami
trainheroic coach athletes
trainheroic athlete profile
trainheroic athlete export
trainheroic help`;
