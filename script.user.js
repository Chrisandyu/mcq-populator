// ==UserScript==
// @name         final
// @match        *://*.schoology.com/*
// @grant        GM_xmlhttpRequest
// ==/UserScript==

(function() {
    'use strict';

    const API_KEY = 'ENTER API KEY HERE';
    const MODEL = 'gemma-3-4b-it';
    const sleep = ms => new Promise(r => setTimeout(r, ms));

    async function callGemini(text) {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${API_KEY}`;

        // Explicit prompt to ensure formatting
        const promptText = `Extract Multiple Choice Question (MCQ) data from the text below.
Return ONLY a raw JSON object. Do not include markdown code blocks.
The JSON must follow this exact structure:
{
  "question": "The question text",
  "responses": {
    "1": "First choice",
    "2": "Second choice",
    "3": "Third choice",
    "4": "Fourth choice",
    "5": "Fifth choice (or null if not exists)"
  },
  "answer": 1
}

Include the FULL question always, there can be multiple sentences. Example:
"A student measures the mass of a sample of a metallic element, M. Then the student heats the sample in air, where it completely reacts to form the compound MO. The student measures the mass of the compound that was formed.
Which of the following questions can be answered from the results of the experiment?"

This is a full question.
If there is context before the actual question statement, include it as part of the question as well.
For example, if there is a chemical equation like: "CO2(g) + 2 LiOH(s) → Li2CO3(aq) + H2O(l)", include it
in the question if it is needed to answer the question and IS NOT an option itself.

Text to extract from: ${text}`;

        const payload = {
        contents: [{ parts: [{ text: promptText }] }],
        generationConfig: {
            temperature: 0.2,
        }
    };

        return new Promise((resolve, reject) => {
            GM_xmlhttpRequest({
                method: "POST",
                url: url,
                headers: { "Content-Type": "application/json" },
                data: JSON.stringify(payload),
                onload: (res) => {
                    try {
                        const data = JSON.parse(res.responseText);

                        if (data.error) {
                            console.error("Gemini API Error:", data.error.message);
                            reject(data.error.message);
                            return;
                        }

                        let aiResponseText = data.candidates[0].content.parts[0].text;

                        aiResponseText = aiResponseText.replace(/```json/g, "").replace(/```/g, "").trim();

                        const jsonObject = JSON.parse(aiResponseText);
                        console.log("Extracted JSON:", jsonObject);
                        resolve(jsonObject);
                    } catch (e) {
                        console.error("Parsing Error:", e, res.responseText);
                        reject("cannot parse ai response");
                    }
                },
                onerror: (err) => reject(err)
            });
        });
    }

    async function setEditorValue(element, text) {
        if (!element) return;
        element.focus();
        document.execCommand('selectAll', false, null);
        document.execCommand('delete', false, null);
        document.execCommand('insertHTML', false, text);

        const events = ['input', 'change', 'keyup'];
        events.forEach(evt => element.dispatchEvent(new Event(evt, { bubbles: true })));

        await sleep(100);
        element.blur();
    }

    async function adjustOptionCount(targetCount) {
        let currentCount = document.querySelectorAll('button.lrn-qe-btn-remove').length;

        if (currentCount < targetCount) {
            const addButton = document.querySelector('button[aria-label="Option"]');
            if (addButton) {
                for (let i = 0; i < (targetCount - currentCount); i++) {
                    addButton.click();
                    await sleep(500);
                }
            }
        } else if (currentCount > targetCount) {
            for (let i = currentCount - 1; i >= targetCount; i--) {
                let currentButtons = document.querySelectorAll('button.lrn-qe-btn-remove');
                if(currentButtons[i]) {
                    currentButtons[i].click();
                    await sleep(300);
                }
            }
        }
        await sleep(800);
    }

    async function populateSchoologyQuestion(data) {

        const responseList = Object.values(data.responses).filter(val => val !== null && val !== "" && val !== "null");
        await adjustOptionCount(responseList.length);

        const questionBox = document.querySelector('div[aria-label="Compose question"]');
        if (questionBox) {
            await setEditorValue(questionBox, data.question);
        }

        for (let i = 0; i < responseList.length; i++) {
            const allEditables = document.querySelectorAll('.lrn-qe-edit-form [contenteditable="true"]');
            const actualAnswers = Array.from(allEditables).filter(box => {
                const label = box.getAttribute('aria-label') || "";
                return label.includes("Label") || label.includes("Description");
            });

            if (actualAnswers[i]) {
                await setEditorValue(actualAnswers[i], responseList[i]);
                console.log(`filled ${i + 1}`);
            }
        }

        const checkmarks = document.querySelectorAll('.lrn-qe-checkmark, input[type="radio"]');
        if (checkmarks[data.answer - 1]) {
            checkmarks[data.answer - 1].click();
        }


        const shuffleContainer = document.querySelector('[data-lrn-qe-input-path="shuffle_options"]');
        if (shuffleContainer) {
            const checkbox = shuffleContainer.querySelector('input[type="checkbox"]');
            const trigger = shuffleContainer.querySelector('.lrn-qe-switch-trigger');
            if (checkbox && !checkbox.checked && trigger) trigger.click();
        }

    }

    function notify(text, isLoading = false) {
        const toast = document.createElement("div");

        const spinnerHtml = isLoading ? `<div class="spinner"></div>` : "";
        toast.innerHTML = `${spinnerHtml}<span>${text}</span>`;

        Object.assign(toast.style, {
            position: "fixed", top: "20px", right: "20px",
            backgroundColor: "#7E78D2", color: "white", padding: "12px 24px",
            borderRadius: "8px", zIndex: "10000", fontWeight: "bold",
            boxShadow: "0 4px 12px rgba(0,0,0,0.2)", display: "flex",
            alignItems: "center", gap: "12px", transition: "opacity 0.5s"
        });

        if (!document.getElementById("notify-styles")) {
            const style = document.createElement("style");
            style.id = "notify-styles";
            style.innerHTML = `
            .spinner {
                width: 18px; height: 18px;
                border: 3px solid rgba(255,255,255,0.3);
                border-top: 3px solid white;
                border-radius: 50%;
                animation: spin 0.8s linear infinite;
            }
            @keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }
        `;
            document.head.appendChild(style);
        }

        document.body.appendChild(toast);

        if (!isLoading) {
            setTimeout(() => {
                toast.style.opacity = "0";
                setTimeout(() => toast.remove(), 500);
            }, 3000);
        }

        return toast;
    }

    document.addEventListener('keydown', async (e) => {
        if (e.ctrlKey && e.shiftKey && e.code === 'KeyL') {
            const testData = {
                question: "what is a chemical change?",
                responses: {
                    1: "water freezing",
                    2: "wood burning",
                    3: "sugar dissolving",
                    4: "cutting paper into 9999 pieces"
                },
                answer: 2,
            };
            await populateSchoologyQuestion(testData);
        }

        if (e.ctrlKey && e.shiftKey && e.code === 'KeyQ') {
            try {
                window.focus();
                const clipboardText = await navigator.clipboard.readText();
                console.log("clip done");

                const loading = notify("loading", true);

                const aiData = await callGemini(clipboardText);
                console.log("data done: ", aiData);
                loading.remove();

                const pop = notify("populating", true);
                await populateSchoologyQuestion(aiData);
                pop.remove()
                console.log("workflow success")
            } catch (err) {
                console.error("workflow failed:", err);
            }
        }
    });

})();
