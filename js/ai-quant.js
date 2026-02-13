// AI Quant frontend logic
(function() {
    const promptButtonsEl = document.getElementById('promptButtons');
    const contextSelect = document.getElementById('contextSelect');
    const aiOutput = document.getElementById('aiOutput');
    const aiInput = document.getElementById('aiInput');
    const askButton = document.getElementById('askButton');
    const statusLine = document.getElementById('contextStatus');

    const quickPrompts = [
        {
            label: 'Given today\'s high-RVOL gappers, which 3 tickers offer the cleanest risk/reward for an opening drive?',
            context: 'scanner'
        },
        {
            label: 'Look at today\'s SEC earnings filings and group them into bullish, neutral, and potentially negative setups.',
            context: 'sec'
        },
        {
            label: 'Using my current scan, suggest two tight-risk trade ideas and where I should be wrong.',
            context: 'scanner'
        },
        {
            label: 'Explain today\'s most interesting catalyst setups in layman\'s terms.',
            context: 'sec'
        }
    ];

    function renderPrompts() {
        if (!promptButtonsEl) return;
        promptButtonsEl.innerHTML = '';
        quickPrompts.forEach(prompt => {
            const btn = document.createElement('button');
            btn.className = 'prompt-btn';
            btn.type = 'button';
            btn.textContent = prompt.label;
            btn.addEventListener('click', () => {
                aiInput.value = prompt.label;
                contextSelect.value = prompt.context;
                aiInput.focus();
            });
            promptButtonsEl.appendChild(btn);
        });
    }

    function appendExchange(question, answer, usedContext) {
        const wrapper = document.createElement('div');
        wrapper.className = 'ai-exchange';

        const copyBtn = document.createElement('button');
        copyBtn.className = 'copy-btn';
        copyBtn.type = 'button';
        copyBtn.textContent = 'Copy text';
        copyBtn.addEventListener('click', async () => {
            try {
                await navigator.clipboard.writeText(answer);
                copyBtn.textContent = 'Copied!';
                setTimeout(() => (copyBtn.textContent = 'Copy text'), 1600);
            } catch (err) {
                copyBtn.textContent = 'Copy failed';
                setTimeout(() => (copyBtn.textContent = 'Copy text'), 1600);
            }
        });

        const contextTag = document.createElement('div');
        contextTag.className = 'context-tag';
        contextTag.textContent = `Context: ${usedContext || 'none'}`;

        const qEl = document.createElement('div');
        qEl.className = 'question';
        qEl.textContent = question;

        const aEl = document.createElement('div');
        aEl.className = 'answer';
        aEl.textContent = answer;

        wrapper.appendChild(copyBtn);
        wrapper.appendChild(contextTag);
        wrapper.appendChild(qEl);
        wrapper.appendChild(aEl);

        aiOutput.querySelector('.helper-text')?.remove();
        aiOutput.appendChild(wrapper);
        aiOutput.scrollTop = aiOutput.scrollHeight;
    }

    async function fetchStatuses() {
        const parts = [];
        try {
            const res = await fetch('/api/scanner/status');
            const data = await res.json();
            parts.push(data.message || (data.available ? 'Scanner context available' : 'Scanner context unavailable'));
        } catch (err) {
            parts.push('Scanner status unavailable');
        }

        try {
            const res = await fetch('/api/sec-earnings-status');
            const data = await res.json();
            parts.push(data.message || (data.available ? 'SEC filings available' : 'SEC filings unavailable'));
        } catch (err) {
            parts.push('SEC filings status unavailable');
        }

        try {
            const res = await fetch('/api/ai-quant/status');
            const data = await res.json();
            parts.push(data.message || (data.available ? `AI Quant model ${data.model}` : 'AI Quant key missing'));
        } catch (err) {
            parts.push('AI Quant status unavailable');
        }

        statusLine.textContent = parts.filter(Boolean).join(' | ');
    }

    async function askQuestion() {
        const prompt = aiInput.value.trim();
        const contextSource = contextSelect.value || 'none';
        if (!prompt) return;

        askButton.disabled = true;
        askButton.textContent = 'Asking...';

        try {
            const response = await fetch('/api/ai-quant/query', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ prompt, contextSource })
            });

            if (!response.ok) {
                throw new Error('Request failed');
            }

            const data = await response.json();
            appendExchange(prompt, data.answer || 'No answer returned.', data.usedContext || contextSource);
            aiInput.value = '';
        } catch (err) {
            const message = 'AI Quant is unavailable right now. Please try again.';
            appendExchange(prompt, message, contextSource);
        } finally {
            askButton.disabled = false;
            askButton.textContent = 'Ask AI Quant';
        }
    }

    function bindEvents() {
        askButton.addEventListener('click', askQuestion);
        aiInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                askQuestion();
            }
        });
    }

    function init() {
        renderPrompts();
        fetchStatuses();
        bindEvents();
        if (window.lucide && window.lucide.createIcons) {
            window.lucide.createIcons();
        }
    }

    document.addEventListener('DOMContentLoaded', init);
})();
