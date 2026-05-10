# LeetCode Interviewer

A Chrome extension that adds an AI-powered side panel to LeetCode problem pages. Includes a structured mock interviewer, progressive hints, and a free-form chat assistant, run by OpenRouter.

## Features

- **Interview Mode** — Simulates a real coding interview across 7 stages: Clarification → Brute Force → Optimization → Complexity → Edge Cases → Implementation → Testing. The AI asks one question at a time, never gives away the answer, and nudges you when you're stuck.
- **Hint Mode** — Generates 5 progressive hints for the current problem, from a vague high-level insight to a final nudge before the solution.
- **Ask Mode** — Chat freely about the problem. Ask about approach, complexity, edge cases, or anything else.
- **Countdown Timer** — Set a time limit to simulate real interview pressure. Turns orange and red as time runs out.
- **Text-to-Speech** — AI responses are read aloud. Toggle on/off from the chat input bar.
- **Auto-loads problem context** — Fetches the problem title, description, difficulty, and tags directly from LeetCode's API when you open a problem.
- **Light/Dark theme** — Follows LeetCode's own dark mode automatically.

## Setup

1. Clone or download this repository.
2. Open `chrome://extensions` and enable **Developer mode**.
3. Click **Load unpacked** and select the project folder.
4. Open `content.js` and replace the `OPENROUTER_API_KEY` constant at the top with your key from [openrouter.ai](https://openrouter.ai).
5. (Optional) Change the `MODEL` constant to use a different model. Default is `openai/gpt-4o-mini`.

## Usage

Navigate to any LeetCode problem page. An **AI Chat** button will appear next to the Submit button. Click it to open the panel.
