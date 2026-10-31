# @your-namespace/dsh-generic-pipeline

A highly adaptive, multi-agent agentic engineering pipeline for the **DeepSeek Harness (`dsh`)** environment built on the **Cordis** framework. 

This plugin orchestrates a structured **Architect ➔ Runner ➔ Tester** lifecycle to completely build, write, and execute code sandboxes autonomously using your custom high-reasoning and zero-reasoning local/cloud model endpoints.

## 🏗️ Architecture Design

The plugin separates your infrastructure layout into three distinct phases to maximize efficiency, speed, and logical consistency:

1. **The Architect (High Reasoning / Deep Thinking):** Utilizes a deep-thinking model (like `Qwen 27B` with `reasoning_effort: xhigh`) to handle structural logic, planning, and codebase generation.
2. **The Runner (Zero Reasoning / Fast E2E):** Utilizes a fast model (like `Gemma 4 12B` with `thinkingEnabled: false` and `temperature: 0`) to quickly write execution wrappers, deployment scripts, or integration tests without structural delays.
3. **The Tester (Shell Sandbox Automation):** Spawns an isolated terminal process to execute the codebase directly via the host's terminal, reporting test statuses or stack traces back to your harness live log.

---

## 🛠️ Global Configuration (`settings.yml`)

The plugin maps directly to your custom `llm-pi-ai` multi-provider keys. Ensure your endpoints are structured in your configuration like this:

```yaml
llm-pi-ai:
  providers:
    # --- Local Ollama Runner ---
    ollama-local:
      api: openai-completions
      baseUrl: http://localhost:11434/v1
      apiKey: "ollama"
      models:
        - id: openai-completions/gemma4:12b
          name: gemma4:12b

    # --- Local vLLM/Llama.cpp Architect ---
    openai:
      api: openai-completions
      baseUrl: http://localhost:8001/v1
      timeoutMs: 600000
      streamIdleTimeoutMs: 600000
      models:
        - id: openai/qwen3.8-27b-k4_xl-thinking
          name: Qwen3.8-27B-Q4_K_M-x
          reasoning_effort: xhigh
          thinkingEnabled: true
```

---

## 🚀 Installation & Activation

1. Drop this repository directory inside your local plugins workspace folder.
2. Link the package location to your deep-seek-harness web execution engine profile:
   ```bash
   dsh plugin --profile web add /path/to/dsh-generic-pipeline
   ```
3. Restart your workspace web panel to clear old runtime chunks and compile the fresh macro modules:
   ```bash
   dsh web --clear-cache
   ```

---

## 💻 Usage & Macro Triggers

Once active, open your `dsh` chat window dashboard (`http://127.0.0.1:3080`) and trigger the universal pipeline macro directly using slash notation:

```text
/pipeline "[Your complete system specification request here]"
```

### Prompt Examples:
* **Python Backends:** `/pipeline "Create a Python FastAPI microservice that handles secure user photo uploads and parses image metadata"`
* **Node Utilities:** `/pipeline "Write a vanilla JavaScript state machine for an autonomous text markdown parsing engine"`

---

## ⚙️ Plugin Properties (GUI Settings Block)

If you are using the graphical harness dashboard UI, you can modify these runtime variables inside the plugin configuration panel directly:

* **`architectProvider`**: Key of your high-reasoning engine provider (Default: `openai`).
* **`architectModel`**: Target model ID for code architecting (Default: `openai/qwen3.8-27b-k4_xl-thinking`).
* **`runnerProvider`**: Key of your execution runner provider (Default: `ollama-local`).
* **`runnerModel`**: Target model ID for quick test-script generation (Default: `openai-completions/gemma4:12b`).
* **`testTimeoutMs`**: Maximum duration allowed for the execution sandbox block before hitting a hard network watchdog halt (Default: `600000` / 10 minutes).

