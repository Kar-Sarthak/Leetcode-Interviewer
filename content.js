(function() {

  const OPENROUTER_API_KEY = 'api_key';
  const OPENROUTER_API_URL = 'https://openrouter.ai/api/v1/chat/completions';
  const MODEL = 'openai/gpt-4o-mini';
  const LEETCODE_GRAPHQL = 'https://leetcode.com/graphql';

  let problemContext = null;
  let progressiveHints = [];
  let currentMode = 'hint';



  const INTERVIEW_STAGES = [
    'clarification', 'brute_force', 'optimization',
    'complexity', 'edge_cases', 'implementation', 'testing'
  ];

  const STAGE_LABELS = {
    clarification:  'Clarification',
    brute_force:    'Brute Force',
    optimization:   'Optimization',
    complexity:     'Complexity',
    edge_cases:     'Edge Cases',
    implementation: 'Coding',
    testing:        'Testing'
  };


  const STAGE_TURN_BUDGET = {
    clarification:  3,
    brute_force:    4,
    optimization:   4,
    complexity:     3,
    edge_cases:     3,
    implementation: 6,
    testing:        3
  };

  let interviewState = {
    stage:         'clarification',
    stageIndex:    0,
    totalTurns:    0,
    stageTurns:    0,
    confusionCount: 0,
    stuckHintUsed: false
  };

  function resetInterviewState() {
    interviewState = {
      stage:         'clarification',
      stageIndex:    0,
      totalTurns:    0,
      stageTurns:    0,
      confusionCount: 0,
      stuckHintUsed: false
    };
  }

  function maybeAdvanceStage() {
    const budget = STAGE_TURN_BUDGET[interviewState.stage] || 3;
    if (interviewState.stageTurns >= budget) {
      const idx = INTERVIEW_STAGES.indexOf(interviewState.stage);
      if (idx < INTERVIEW_STAGES.length - 1) {
        interviewState.stage         = INTERVIEW_STAGES[idx + 1];
        interviewState.stageIndex    = idx + 1;
        interviewState.stageTurns    = 0;
        interviewState.confusionCount = 0;
        interviewState.stuckHintUsed = false;
      }
    }
  }

  function analyzeUserMessage(message) {
    const lower = message.toLowerCase().trim();
    const confusionSignals = [
      "don't know", "not sure", "confused", "no idea",
      "stuck", "help me", "idk", "i have no", "???"
    ];
    const isShort     = lower.length < 20;
    const isConfused  = confusionSignals.some(s => lower.includes(s)) || isShort;
    if (isConfused) {
      interviewState.confusionCount++;
    } else {
      interviewState.confusionCount = Math.max(0, interviewState.confusionCount - 1);
      interviewState.stuckHintUsed  = false;
    }
  }

  function updateStageBar() {
    const tracker  = document.getElementById('lc-stage-tracker');
    const tag      = document.getElementById('lc-stage-tag');
    const countEl  = document.getElementById('lc-stage-count');
    const progress = document.getElementById('lc-stage-progress');

    if (!tracker) return;
    const isInterviewer = currentMode === 'interviewer';
    tracker.style.display = isInterviewer ? 'block' : 'none';
    if (!isInterviewer) return;

    if (tag)     tag.textContent    = STAGE_LABELS[interviewState.stage] || interviewState.stage;
    if (countEl) countEl.textContent = `${interviewState.stageIndex + 1} / ${INTERVIEW_STAGES.length}`;

    if (progress) {
      progress.innerHTML = INTERVIEW_STAGES.map((s, i) => {
        let cls = 'lc-stage-dot';
        if (i < interviewState.stageIndex) cls += ' done';
        else if (i === interviewState.stageIndex) cls += ' active';
        return `<div class="${cls}" title="${STAGE_LABELS[s]}"></div>`;
      }).join('');
    }
  }



  function getStageSystemPrompt(stage, isStuck = false) {
    const problemInfo = problemContext
      ? `Problem: "${problemContext.title}" (${problemContext.difficulty} difficulty)\n\nStatement:\n${problemContext.description.substring(0, 800)}`
      : 'Problem context unavailable — proceed with general interview behavior.';

    const coreRules = `You are a senior software engineer conducting a real technical coding interview.

${problemInfo}

STRICT RULES — follow every one of these:
1. Ask EXACTLY ONE question per message. Never two. Never a list of questions.
2. Keep responses SHORT — 1 to 3 sentences. No lectures.
3. NEVER give away the answer or the optimal approach. Let the candidate discover it.
4. DO NOT say "Great!", "Good!", "Nice!", "Interesting!" on every turn. It sounds fake.
   Natural, varied acknowledgements only: "Okay.", "Right.", "I see.", "Sure.", "Go ahead.",
   "Mmm.", "Alright.", "Makes sense." — use sparingly, not in every message.
5. Challenge assumptions proactively: "Why is that correct?", "What's the worst case?",
   "Are you sure?", "Can this fail?", "What if the input is X?"
6. If the candidate mentions a specific data structure or algorithm, always ask WHY they chose it.
7. Sound like a real person — terse, natural, thoughtful. Not an assistant. Not a tutor.`;

    const stageInstructions = {

      clarification: `
STAGE: Clarification
Goal — confirm the candidate understands the problem before any solving begins.
- Open with a brief greeting (one sentence), then ask ONE question about their understanding.
- If they ask a clarifying question (constraints, edge cases, input format), answer concisely,
  then ask "Anything else unclear?" — nothing more.
- When they say they're ready, transition: "Alright, what's your initial thought?" — that's it.
- Do NOT suggest approaches. Do NOT ask about complexity. Stay in this stage.`,

      brute_force: `
STAGE: Brute Force / Initial Approach
Goal — hear their first, unoptimized idea without guiding them.
- Ask them to walk through the simplest approach they can think of, even if slow.
- If they jump to an optimized solution immediately, redirect: "Walk me back to the simplest
  thing you could code right now, even if it's O(n²)."
- If vague, probe: "What would you literally do step by step?"
- Do NOT name data structures. Do NOT suggest approaches. Make them propose something.`,

      optimization: `
STAGE: Optimization
Goal — push the candidate to recognize and fix inefficiencies.
- Open with: "Can we do better here?" or "What's the bottleneck?"
- If they mention a specific structure (heap, hashmap, trie, etc.), ask: "Why does that help
  here specifically? What does it buy you?"
- If they mention sorting: "What does sorting cost us, and is that tradeoff worth it?"
- If stuck: "What operation are you repeating unnecessarily?"
- Do NOT confirm whether their optimization is correct — make them reason through it.`,

      complexity: `
STAGE: Complexity Analysis
Goal — test their understanding of time and space tradeoffs.
- Ask for time complexity first: "What's the time complexity of your approach?"
- If they answer, follow with: "And space?"
- If they get it wrong, don't correct immediately: "Walk me through why you think that."
- Probe worst-case: "Is this always O(n), or does it depend on the input structure?"
- Challenge easy answers: "Are you accounting for the sorting step you mentioned?"`,

      edge_cases: `
STAGE: Edge Cases
Goal — test their thoroughness and defensive thinking.
- Open with: "What edge cases are you thinking about?"
- If they miss obvious ones, pick ONE and ask specifically: "What if the array is empty?"
  or "What about negative numbers?" — never list them all.
- Ask them to verify: "How does your current solution handle that?"
- Do NOT enumerate edge cases for them. Probe one at a time.`,

      implementation: `
STAGE: Implementation / Coding
Goal — observe their coding process and narration.
- Encourage think-aloud: "Walk me through what you're writing as you go."
- Ask them to trace through the sample input manually.
- If you suspect a bug, do NOT point it out: ask "What does this evaluate to when X is Y?"
  or "Does this line do what you think it does?"
- Ask about deliberate choices: "Why did you choose [X] here instead of [Y]?"
- Let them code — only interrupt when a question adds real value.`,

      testing: `
STAGE: Testing & Wrap-Up
Goal — verify correctness and close the interview naturally.
- Ask them to trace through the sample test case step by step.
- Then: "What test case would you add beyond the given examples?"
- If the solution holds up: "Looks solid. Any thoughts on alternative approaches?"
- Keep it brief and natural. This is the wind-down.`
    };

    let prompt = coreRules + '\n' + (stageInstructions[stage] || stageInstructions.clarification);

    if (isStuck && !interviewState.stuckHintUsed) {
      prompt += `

CANDIDATE APPEARS STUCK — give ONE directional nudge only:
- Do NOT give the answer. Give a single subtle hint, for example:
  "Think about what information you need to keep track of across iterations."
  or "Is there a structure that gives you O(1) lookup?"
  or "What if you processed from the other end?"
- This nudge replaces your question for this turn.
- Ask nothing else.`;
      interviewState.stuckHintUsed = true;
    }

    return prompt;
  }

  function buildInterviewerMessages() {
    const isStuck      = interviewState.confusionCount >= 2;
    const systemPrompt = getStageSystemPrompt(interviewState.stage, isStuck);

    return [
      { role: 'system', content: systemPrompt },
      ...chatHistories.interviewer
    ];
  }



  const chatHistories = { ask: [], interviewer: [] };

  const interviewerInitialized = { ask: false, interviewer: false };

  const ASK_SYSTEM_PROMPT = "You are a coding assistant for LeetCode problem: {{PROBLEM_TITLE}}. Description: {{PROBLEM_DESC}}. The user will ask you questions about the problem. Provide helpful, concise answers about approach, complexity, edge cases, and implementation. Be supportive but don't give away the full solution unless explicitly asked.";



  let ttsEnabled = true;
  let preferredVoice = null;
  let voiceLoadingPromise = null;

  const PREFERRED_VOICE_NAMES = [
    'Google UK English Female','Google US English Female',
    'Microsoft Jenny','Microsoft Susan','Samantha',
    'Google UK English Male','Google US English Male',
    'Microsoft David','Daniel','Karen','Moira','Rishi'
  ];

  function getBestVoice() {
    return new Promise(resolve => {
      if (preferredVoice && speechSynthesis.getVoices().includes(preferredVoice)) { resolve(preferredVoice); return; }
      const voices = speechSynthesis.getVoices();
      if (voices.length === 0) {
        const onVoicesChanged = () => { speechSynthesis.removeEventListener('voiceschanged', onVoicesChanged); resolve(selectBestVoiceFromList(speechSynthesis.getVoices())); };
        speechSynthesis.addEventListener('voiceschanged', onVoicesChanged);
        setTimeout(() => { speechSynthesis.removeEventListener('voiceschanged', onVoicesChanged); resolve(selectBestVoiceFromList(speechSynthesis.getVoices())); }, 1000);
      } else { resolve(selectBestVoiceFromList(voices)); }
    });
  }

  function selectBestVoiceFromList(voices) {
    if (!voices || voices.length === 0) return null;
    for (const name of PREFERRED_VOICE_NAMES) {
      const v = voices.find(v => v.name === name && v.lang.startsWith('en'));
      if (v) return v;
    }
    const local = voices.filter(v => v.lang.startsWith('en') && v.localService === true);
    if (local.length > 0) return local[0];
    return voices.find(v => v.lang.startsWith('en')) || voices[0];
  }

  function preloadBestVoice() {
    if (voiceLoadingPromise) return voiceLoadingPromise;
    voiceLoadingPromise = getBestVoice().then(v => { preferredVoice = v; return v; }).catch(() => null);
    return voiceLoadingPromise;
  }

  async function speakText(text) {
    if (!ttsEnabled || !('speechSynthesis' in window)) return;
    window.speechSynthesis.cancel();
    await preloadBestVoice();
    const u = new SpeechSynthesisUtterance(text);
    u.rate = 0.95; u.pitch = 1.05; u.volume = 1.0;
    if (preferredVoice) u.voice = preferredVoice;
    u.onerror = e => console.warn('TTS error:', e);
    window.speechSynthesis.speak(u);
  }

  function stopSpeaking() { if ('speechSynthesis' in window) window.speechSynthesis.cancel(); }

  function toggleTTS() { ttsEnabled = !ttsEnabled; stopSpeaking(); updateTTSButton(); }

  function updateTTSButton() {
    const btn = document.getElementById('lc-tts-toggle');
    if (!btn) return;
    btn.title = ttsEnabled ? 'Mute AI voice' : 'Unmute AI voice';
    btn.classList.toggle('active', ttsEnabled);
    const on  = `<svg viewBox="0 0 24 24"><path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z"/></svg>`;
    const off = `<svg viewBox="0 0 24 24"><path d="M16.5 12c0-1.77-1.02-3.29-2.5-4.03v2.21l2.45 2.45c.03-.2.05-.41.05-.63zm2.5 0c0 .94-.2 1.82-.54 2.64l1.51 1.51C20.63 14.91 21 13.5 21 12c0-4.28-2.99-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71zM4.27 3L3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06c1.38-.31 2.63-.95 3.69-1.81L19.73 21 21 19.73l-9-9L4.27 3zM12 4L9.91 6.09 12 8.18V4z"/></svg>`;
    btn.innerHTML = ttsEnabled ? on : off;
  }



  function getTitleSlugFromUrl() {
    const match = window.location.pathname.match(/\/problems\/([^/]+)\/?/);
    return match ? match[1] : null;
  }

  function parseHtmlContent(html) {
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');
    doc.querySelectorAll('script, style').forEach(el => el.remove());
    return (doc.body.textContent || '').replace(/\s+/g, ' ').trim();
  }

  async function fetchProblemContext(titleSlug) {
    const query = `
      query questionData($titleSlug: String!) {
        question(titleSlug: $titleSlug) {
          questionId questionFrontendId title titleSlug
          content difficulty topicTags { name } sampleTestCase
        }
      }`;
    try {
      const res = await fetch(LEETCODE_GRAPHQL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Referer': 'https://leetcode.com' },
        body: JSON.stringify({ operationName: 'questionData', variables: { titleSlug }, query })
      });
      if (!res.ok) throw new Error(`GraphQL error: ${res.status}`);
      const data = await res.json();
      const q = data.data?.question;
      if (!q) throw new Error('No question data');
      return {
        id: q.questionId, frontendId: q.questionFrontendId,
        title: q.title, slug: q.titleSlug, difficulty: q.difficulty,
        description: parseHtmlContent(q.content),
        topics: q.topicTags?.map(t => t.name) || [],
        example: q.sampleTestCase
      };
    } catch (e) {
      console.error('Failed to fetch problem context:', e);
      return null;
    }
  }



  async function generateProgressiveHints() {
    if (!problemContext) return [];
    const fallback = [
      { id: 1, content: "Think about the core requirement of the problem.", expanded: false },
      { id: 2, content: "Consider what data structure would efficiently store and lookup values.", expanded: false },
      { id: 3, content: "What edge cases should you handle? (empty input, duplicates, etc.)", expanded: false },
      { id: 4, content: "Think about the time and space complexity of your approach.", expanded: false },
      { id: 5, content: "Can you optimize from a brute force O(n²) to something better?", expanded: false }
    ];
    try {
      const prompt = `You are a LeetCode hint generator. For the problem "${problemContext.title}" (${problemContext.difficulty}), generate exactly 5 progressive hints.

Problem Description: ${problemContext.description.substring(0, 1000)}

Generate 5 hints where:
- Hint 1: High-level approach or key insight (very general)
- Hint 2: Data structure or algorithm suggestion
- Hint 3: Important edge case or constraint to consider
- Hint 4: More specific guidance on implementation
- Hint 5: Final nudge toward the solution (NOT the actual code)

Return ONLY a JSON array of 5 strings, nothing else. No markdown, no backticks.
Example: ["Hint 1 text...", "Hint 2 text...", "Hint 3 text...", "Hint 4 text...", "Hint 5 text..."]`;

      const res = await fetch(OPENROUTER_API_URL, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${OPENROUTER_API_KEY}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': 'https://leetcode.com',
          'X-Title': 'LeetCode Helper Extension'
        },
        body: JSON.stringify({ model: MODEL, messages: [{ role: 'user', content: prompt }], temperature: 0.3 })
      });
      if (!res.ok) throw new Error(`API error: ${res.status}`);
      const data = await res.json();
      const content = data.choices?.[0]?.message?.content || '[]';
      const match = content.match(/\[.*\]/s);
      if (match) {
        const hints = JSON.parse(match[0]);
        return hints.slice(0, 5).map((h, i) => ({ id: i + 1, content: h, expanded: false }));
      }
      return fallback;
    } catch (e) {
      console.error('Failed to generate hints:', e);
      return fallback;
    }
  }



  async function initializeProblemContext() {
    const titleSlug = getTitleSlugFromUrl();
    if (!titleSlug) return;
    showHintsLoading();
    problemContext = await fetchProblemContext(titleSlug);
    if (problemContext) {

      if (chatHistories.ask.length === 0) {
        chatHistories.ask = [{
          role: 'system',
          content: ASK_SYSTEM_PROMPT
            .replace('{{PROBLEM_TITLE}}', problemContext.title)
            .replace('{{PROBLEM_DESC}}', problemContext.description.substring(0, 800) + '...')
        }];
      }

      progressiveHints = await generateProgressiveHints();
      renderCurrentMode();
    } else {
      showError('⚠️ Could not load problem context. AI responses may be less accurate.');
      renderCurrentMode();
    }
  }



  function showHintsLoading() {
    const hintsContainer = document.getElementById('lc-hints-container');
    const loadingDiv     = document.getElementById('lc-hints-loading');
    const chatContainer  = document.getElementById('lc-chat-container');
    if (hintsContainer) hintsContainer.classList.remove('visible');
    if (chatContainer)  chatContainer.classList.remove('visible');
    if (loadingDiv) {
      const msgEl = loadingDiv.querySelector('.lc-loading-text');
      if (msgEl) msgEl.textContent = problemContext ? `Generating hints for ${problemContext.title}...` : 'Generating hints...';
      loadingDiv.classList.add('visible');
    }
  }

  function renderHints() {
    const hintsContainer = document.getElementById('lc-hints-container');
    const loadingDiv     = document.getElementById('lc-hints-loading');
    const chatContainer  = document.getElementById('lc-chat-container');
    if (!hintsContainer || !loadingDiv) return;
    loadingDiv.classList.remove('visible');
    if (chatContainer) chatContainer.classList.remove('visible');
    hintsContainer.classList.add('visible');
    hintsContainer.innerHTML = '';

    if (progressiveHints.length === 0) {
      hintsContainer.innerHTML = `<div class="lc-empty-state"><div class="lc-empty-icon">💡</div><p>Unable to generate hints for this problem.</p><p class="lc-empty-sub">Try switching to Ask mode instead.</p></div>`;
      return;
    }

    progressiveHints.forEach((hint, index) => {
      const card = document.createElement('div');
      card.className = `lc-hint-card ${hint.expanded ? 'expanded' : ''}`;
      card.dataset.hintId = hint.id;
      card.innerHTML = `
        <div class="lc-hint-header">
          <div class="lc-hint-number">
            <div class="lc-hint-badge">${hint.id}</div>
            <span>Hint ${hint.id}</span>
          </div>
          <svg class="lc-hint-toggle-icon" viewBox="0 0 24 24"><path d="M7.41 8.59L12 13.17l4.59-4.58L18 10l-6 6-6-6 1.41-1.41z"/></svg>
        </div>
        <div class="lc-hint-content">${hint.content}</div>
      `;
      card.addEventListener('click', () => toggleHint(index));
      hintsContainer.appendChild(card);
    });
  }

  function toggleHint(index) {
    if (index < 0 || index >= progressiveHints.length) return;
    progressiveHints[index].expanded = !progressiveHints[index].expanded;
    renderHints();
  }



  function renderChatHistory(mode) {
    const messagesContainer = document.getElementById('lc-chat-messages');
    if (!messagesContainer) return;
    messagesContainer.innerHTML = '';

    const history = chatHistories[mode] || [];
    const displayMessages = history.filter(m => m.role !== 'system');

    if (displayMessages.length === 0) {
      showChatWelcome(mode);
      return;
    }

    displayMessages.forEach(msg => {
      addMessage(msg.content, msg.role === 'assistant' ? 'ai' : 'user', mode, true);
    });

    messagesContainer.scrollTop = messagesContainer.scrollHeight;
  }

  function showChatWelcome(mode) {
    const messagesContainer = document.getElementById('lc-chat-messages');
    if (!messagesContainer) return;
    const title = problemContext?.title || 'this problem';
    const welcomes = {
      ask: `<div class="lc-welcome-icon">🧠</div><div class="lc-welcome-title">${title}</div><div class="lc-welcome-sub">Ask anything about approach, complexity, or edge cases.</div>`,
      interviewer: `<div class="lc-welcome-icon">🎤</div><div class="lc-welcome-title">${title}</div><div class="lc-welcome-sub">The interviewer will guide you. Explain your thinking as you go.</div>`
    };
    messagesContainer.innerHTML = `<div class="lc-chat-welcome">${welcomes[mode] || ''}</div>`;
  }

  function renderCurrentMode() {
    updateStageBar();
    if (currentMode === 'hint') renderHints();
    else renderChatForMode(currentMode);
  }

  function renderChatForMode(mode) {
    const hintsContainer = document.getElementById('lc-hints-container');
    const loadingDiv     = document.getElementById('lc-hints-loading');
    const chatContainer  = document.getElementById('lc-chat-container');
    if (hintsContainer) hintsContainer.classList.remove('visible');
    if (loadingDiv)     loadingDiv.classList.remove('visible');
    if (chatContainer)  chatContainer.classList.add('visible');

    if (mode === 'interviewer' && !interviewerInitialized.interviewer && problemContext) {
      sendInitialInterviewerMessage();
    } else {
      renderChatHistory(mode);
    }
  }


  async function sendInitialInterviewerMessage() {
    interviewerInitialized.interviewer = true;
    resetInterviewState();
    chatHistories.interviewer = [];
    updateStageBar();

    showTyping();

    try {
      const systemPrompt = getStageSystemPrompt('clarification');
      const aiResponse = await callOpenRouter([
        { role: 'system', content: systemPrompt },
        { role: 'user', content: '[The interview is starting now. Greet the candidate and ask your opening question.]' }
      ]);

      const delay = 700 + Math.random() * 900;
      await new Promise(r => setTimeout(r, delay));
      hideTyping();

      chatHistories.interviewer.push({ role: 'assistant', content: aiResponse });
      renderChatHistory('interviewer');
      speakText(aiResponse);
    } catch (e) {
      hideTyping();
      const fallback = `Hi! I'll be your interviewer today. We're working on "${problemContext?.title || 'this problem'}". Have you read through the problem statement?`;
      chatHistories.interviewer.push({ role: 'assistant', content: fallback });
      renderChatHistory('interviewer');
      speakText(fallback);
    }
  }



  const panelHTML = `
    <div id="lc-ext-backdrop"></div>
    <div id="lc-ext-panel">

      <div class="lc-ext-header">
        <div class="lc-header-left">
          <div class="lc-header-logo">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M9 21c0 .55.45 1 1 1h4c.55 0 1-.45 1-1v-1H9v1zm3-19C8.14 2 5 5.14 5 9c0 2.38 1.19 4.47 3 5.74V17c0 .55.45 1 1 1h6c.55 0 1-.45 1-1v-2.26c1.81-1.27 3-3.36 3-5.74 0-3.86-3.14-7-7-7z"/>
            </svg>
          </div>
          <span class="lc-header-title">AI Assistant</span>
        </div>
        <div class="lc-ext-close" id="lc-ext-close-btn" title="Close">
          <svg viewBox="0 0 24 24"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>
        </div>
      </div>

      <div class="lc-timer-section">
        <div class="lc-timer-inner">
          <div id="lc-timer-display" class="lc-timer-display">20:00</div>
          <div class="lc-timer-controls">
            <select id="lc-timer-select" class="lc-timer-select">
              <option value="5">5 min</option><option value="10">10 min</option>
              <option value="15">15 min</option><option value="20" selected>20 min</option>
              <option value="25">25 min</option><option value="30">30 min</option>
              <option value="45">45 min</option><option value="60">60 min</option>
            </select>
            <button id="lc-timer-start"  class="lc-timer-btn primary">
              <svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>Start
            </button>
            <button id="lc-timer-pause"  class="lc-timer-btn secondary" style="display:none;">
              <svg viewBox="0 0 24 24"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/></svg>Pause
            </button>
            <button id="lc-timer-reset"  class="lc-timer-btn ghost">
              <svg viewBox="0 0 24 24"><path d="M17.65 6.35C16.2 4.9 14.21 4 12 4c-4.42 0-7.99 3.58-7.99 8s3.57 8 7.99 8c3.73 0 6.84-2.55 7.73-6h-2.08c-.82 2.33-3.04 4-5.65 4-3.31 0-6-2.69-6-6s2.69-6 6-6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z"/></svg>
            </button>
          </div>
        </div>
      </div>

      <div class="lc-mode-selector">
        <button class="lc-mode-btn active" data-mode="hint">
          <svg viewBox="0 0 24 24"><path d="M9 21c0 .55.45 1 1 1h4c.55 0 1-.45 1-1v-1H9v1zm3-19C8.14 2 5 5.14 5 9c0 2.38 1.19 4.47 3 5.74V17c0 .55.45 1 1 1h6c.55 0 1-.45 1-1v-2.26c1.81-1.27 3-3.36 3-5.74 0-3.86-3.14-7-7-7z"/></svg>
          Hints
        </button>
        <button class="lc-mode-btn" data-mode="ask">
          <svg viewBox="0 0 24 24"><path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2z"/></svg>
          Ask
        </button>
        <button class="lc-mode-btn" data-mode="interviewer">
          <svg viewBox="0 0 24 24"><path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3zm5.3-3c0 3-2.54 5.1-5.3 5.1S6.7 14 6.7 11H5c0 3.41 2.72 6.23 6 6.72V21h2v-3.28c3.28-.48 6-3.3 6-6.72h-1.7z"/></svg>
          Interview
        </button>
      </div>

      <div id="lc-stage-tracker" class="lc-stage-tracker" style="display:none;">
        <div class="lc-stage-info">
          <span class="lc-stage-tag" id="lc-stage-tag">Clarification</span>
          <span class="lc-stage-count" id="lc-stage-count">1 / 7</span>
        </div>
        <div class="lc-stage-progress" id="lc-stage-progress"></div>
      </div>

      <div class="lc-ext-content">
        <div id="lc-chat-error" class="lc-chat-error"></div>

        <div id="lc-hints-loading" class="lc-hints-loading">
          <div class="lc-spinner">
            <svg viewBox="0 0 24 24"><path d="M12 4V2C6.48 2 2 6.48 2 12h2c0-4.41 3.59-8 8-8zm0 14c-2.21 0-4-1.79-4-4H6c0 3.31 2.69 6 6 6s6-2.69 6-6h-2c0 2.21-1.79 4-4 4z"/></svg>
          </div>
          <div class="lc-loading-text">Generating hints...</div>
        </div>

        <div id="lc-hints-container"></div>

        <div id="lc-chat-container">
          <div id="lc-chat-messages"></div>
          <div class="lc-chat-input-container">
            <form id="lc-chat-form" class="lc-chat-form">
              <textarea id="lc-chat-input" placeholder="Ask a question..." rows="1" autocomplete="off"></textarea>
              <div class="lc-input-actions">
                <button type="button" id="lc-tts-toggle" title="Mute AI voice">
                  <svg viewBox="0 0 24 24"><path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z"/></svg>
                </button>
                <button type="submit" id="lc-chat-send">
                  <svg viewBox="0 0 24 24"><path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/></svg>
                </button>
              </div>
            </form>
          </div>
        </div>
      </div>

    </div>
  `;



  const container = document.createElement('div');
  container.innerHTML = panelHTML;
  document.body.appendChild(container);

  const panel         = document.getElementById('lc-ext-panel');
  const backdrop      = document.getElementById('lc-ext-backdrop');
  const closeBtn      = document.getElementById('lc-ext-close-btn');
  const chatError     = document.getElementById('lc-chat-error');
  const modeBtns      = document.querySelectorAll('.lc-mode-btn');

  const timerDisplay  = document.getElementById('lc-timer-display');
  const timerSelect   = document.getElementById('lc-timer-select');
  const timerStartBtn = document.getElementById('lc-timer-start');
  const timerPauseBtn = document.getElementById('lc-timer-pause');
  const timerResetBtn = document.getElementById('lc-timer-reset');

  const chatMessagesElem = document.getElementById('lc-chat-messages');
  const chatForm         = document.getElementById('lc-chat-form');
  const chatInput        = document.getElementById('lc-chat-input');
  const chatSend         = document.getElementById('lc-chat-send');
  const ttsToggleBtn     = document.getElementById('lc-tts-toggle');

  if (ttsToggleBtn) ttsToggleBtn.addEventListener('click', toggleTTS);
  updateTTSButton();



  function togglePanel(show) {
    if (show) {
      panel.classList.add('open');
      backdrop.classList.add('visible');
      updateTimerDisplay();
      updateTimerButtons();
      if (!problemContext) initializeProblemContext();
      else renderCurrentMode();
      if (currentMode !== 'hint' && chatInput) setTimeout(() => chatInput.focus(), 300);
    } else {
      panel.classList.remove('open');
      backdrop.classList.remove('visible');
      stopSpeaking();
    }
  }

  closeBtn.addEventListener('click', () => togglePanel(false));
  backdrop.addEventListener('click', () => togglePanel(false));



  function switchMode(mode) {
    if (currentMode === mode) return;
    stopSpeaking();
    currentMode = mode;
    modeBtns.forEach(btn => btn.classList.toggle('active', btn.dataset.mode === mode));
    const placeholders = { ask: 'Ask a question...', interviewer: 'Respond to the interviewer...' };
    if (chatInput && placeholders[mode]) chatInput.placeholder = placeholders[mode];
    else if (chatInput) chatInput.placeholder = 'Ask a question...';
    updateStageBar();
    if (problemContext) renderCurrentMode();
  }

  modeBtns.forEach(btn => btn.addEventListener('click', () => switchMode(btn.dataset.mode)));



  let timerState = {
    totalSeconds: 20 * 60,
    remainingSeconds: 20 * 60,
    isRunning: false,
    intervalId: null
  };

  function formatTime(s) {
    const m = Math.floor(s / 60);
    return `${String(m).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
  }

  function updateTimerDisplay() {
    timerDisplay.textContent = formatTime(timerState.remainingSeconds);
    timerDisplay.classList.remove('warning', 'danger');
    if (timerState.remainingSeconds <= 60 && timerState.remainingSeconds > 0) timerDisplay.classList.add('danger');
    else if (timerState.remainingSeconds <= 300) timerDisplay.classList.add('warning');
  }

  function updateTimerButtons() {
    const running = timerState.isRunning;
    const idle    = timerState.remainingSeconds === timerState.totalSeconds;
    timerSelect.disabled = running;
    timerStartBtn.style.display = running ? 'none' : 'flex';
    timerPauseBtn.style.display = running ? 'flex' : 'none';
    timerStartBtn.innerHTML = idle
      ? '<svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>Start'
      : '<svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>Resume';
  }

  function startTimer() {
    if (timerState.isRunning) return;
    timerState.isRunning = true;
    updateTimerButtons();
    timerState.intervalId = setInterval(() => {
      if (timerState.remainingSeconds > 0) {
        timerState.remainingSeconds--;
        updateTimerDisplay();
      } else {
        stopTimer();
        timerDisplay.classList.add('danger');
        if ('Notification' in window && Notification.permission === 'granted')
          new Notification("⏰ Time's up!", { body: 'Your LeetCode timer has finished.' });
      }
    }, 1000);
  }

  function pauseTimer() {
    if (!timerState.isRunning) return;
    stopTimer();
    timerState.isRunning = false;
    updateTimerButtons();
  }

  function stopTimer() {
    if (timerState.intervalId) { clearInterval(timerState.intervalId); timerState.intervalId = null; }
  }

  function resetTimer() {
    stopTimer();
    const mins = parseInt(timerSelect.value);
    timerState.totalSeconds = timerState.remainingSeconds = mins * 60;
    timerState.isRunning = false;
    updateTimerDisplay();
    updateTimerButtons();
  }

  timerStartBtn.addEventListener('click', () => {
    if ('Notification' in window && Notification.permission === 'default') Notification.requestPermission();
    startTimer();
  });
  timerPauseBtn.addEventListener('click', pauseTimer);
  timerResetBtn.addEventListener('click', resetTimer);
  timerSelect.addEventListener('change', () => { if (!timerState.isRunning) resetTimer(); });



  function addMessage(content, role, mode, skipTTS = false) {
    const welcome = chatMessagesElem?.querySelector('.lc-chat-welcome');
    if (welcome) welcome.style.display = 'none';

    const msgDiv = document.createElement('div');
    msgDiv.className = `lc-chat-message ${role}`;
    if (role === 'ai') msgDiv.dataset.mode = mode;

    const label = document.createElement('div');
    label.className = 'lc-chat-label';
    label.textContent = role === 'user' ? 'You' : getAILabel(mode);

    const bubble = document.createElement('div');
    bubble.className = 'lc-chat-bubble';
    bubble.textContent = content;

    msgDiv.appendChild(label);
    msgDiv.appendChild(bubble);
    chatMessagesElem.appendChild(msgDiv);
    chatMessagesElem.scrollTop = chatMessagesElem.scrollHeight;

    if (role === 'ai' && !skipTTS) speakText(content);
    return bubble;
  }

  function getAILabel(mode) {
    return { ask: 'Assistant', interviewer: 'Interviewer' }[mode] || 'AI';
  }

  function showTyping() {
    const t = document.createElement('div');
    t.className = 'lc-chat-message ai';
    t.id = 'lc-typing-indicator';
    t.dataset.mode = currentMode;
    t.innerHTML = `<div class="lc-chat-label">${getAILabel(currentMode)}</div><div class="lc-typing"><div class="lc-typing-dot"></div><div class="lc-typing-dot"></div><div class="lc-typing-dot"></div></div>`;
    chatMessagesElem.appendChild(t);
    chatMessagesElem.scrollTop = chatMessagesElem.scrollHeight;
  }

  function hideTyping() {
    const t = document.getElementById('lc-typing-indicator');
    if (t) t.remove();
  }

  function showError(message) {
    if (chatError) {
      chatError.textContent = message;
      chatError.classList.add('visible');
      setTimeout(() => chatError.classList.remove('visible'), 5000);
    }
  }

  async function callOpenRouter(messages) {
    const res = await fetch(OPENROUTER_API_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${OPENROUTER_API_KEY}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://leetcode.com',
        'X-Title': 'LeetCode Helper Extension'
      },
      body: JSON.stringify({ model: MODEL, messages, temperature: 0.7 })
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error?.message || `API Error: ${res.status}`);
    }
    const data = await res.json();
    return data.choices?.[0]?.message?.content || 'No response received.';
  }

  async function handleChatSubmit(e) {
    e.preventDefault();
    const userMessage = chatInput.value.trim();
    if (!userMessage) return;

    stopSpeaking();
    chatInput.disabled = true;
    chatSend.disabled  = true;

    addMessage(userMessage, 'user', currentMode);
    chatHistories[currentMode].push({ role: 'user', content: userMessage });
    chatInput.value = '';
    autoResizeTextarea();
    showTyping();

    try {

      const apiMessages = currentMode === 'interviewer'
        ? buildInterviewerMessages()
        : chatHistories[currentMode];


      if (currentMode === 'interviewer') analyzeUserMessage(userMessage);

      const aiResponse = await callOpenRouter(apiMessages);


      if (currentMode === 'interviewer') {
        const baseDelay = 500;
        const lengthBonus = Math.min(aiResponse.length * 2, 1200);
        const jitter = Math.random() * 700;
        await new Promise(r => setTimeout(r, baseDelay + jitter + (Math.random() > 0.8 ? lengthBonus : 0)));
      }

      hideTyping();
      addMessage(aiResponse, 'ai', currentMode);
      chatHistories[currentMode].push({ role: 'assistant', content: aiResponse });


      if (currentMode === 'interviewer') {
        interviewState.totalTurns++;
        interviewState.stageTurns++;
        maybeAdvanceStage();
        updateStageBar();
      }

    } catch (error) {
      hideTyping();
      showError(`Error: ${error.message}`);
      chatHistories[currentMode].pop();
    } finally {
      chatInput.disabled = false;
      chatSend.disabled  = false;
      chatInput.focus();
    }
  }

  function autoResizeTextarea() {
    if (chatInput) {
      chatInput.style.height = 'auto';
      chatInput.style.height = Math.min(chatInput.scrollHeight, 120) + 'px';
    }
  }

  if (chatForm)  chatForm.addEventListener('submit', handleChatSubmit);
  if (chatInput) {
    chatInput.addEventListener('input', autoResizeTextarea);
    chatInput.addEventListener('keydown', e => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); chatForm?.requestSubmit(); }
    });
  }



  function injectButton() {
    const submitBtn = document.querySelector('button[data-e2e-locator="console-submit-button"]');
    if (submitBtn && !document.getElementById('lc-ext-trigger-btn')) {
      const btn = document.createElement('button');
      btn.id = 'lc-ext-trigger-btn';
      btn.innerText = 'AI Chat';
      btn.addEventListener('click', () => togglePanel(true));
      submitBtn.parentNode.insertBefore(btn, submitBtn.nextSibling);
    }
  }

  const observer = new MutationObserver(() => injectButton());
  observer.observe(document.body, { childList: true, subtree: true });

  preloadBestVoice();
  injectButton();
  updateTimerDisplay();
  updateTimerButtons();

})();