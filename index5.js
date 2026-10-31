// index.js
const { Context, Schema } = require('cordis');
const path = require('path'); // Node built-in utility for joining paths safely

class ProjectPipelinePlugin {
  static inject = ['llm-pi-ai', 'shell'];

  constructor(ctx, config) {
    this.ctx = ctx;
    this.config = config;

    ctx.on('ready', async () => {
      ctx.logger('agent-orchestrator').info('Dynamic Project-Based Pipeline Active.');
    });

    this.registerPipelineCommand();
  }

  registerPipelineCommand() {
    this.ctx.command('pipeline <prompt:text>', 'Run an End-to-End Code Cycle in the current project directory')
      .action(async ({ session }, prompt) => {
        const logger = this.ctx.logger('agent-orchestrator');
        const piAi = this.ctx['llm-pi-ai'];
        
        // DYNAMIC ROOT: Detects the active project folder path dynamically
        const projectRoot = session.cwd || process.cwd(); 
        const srcDir = path.join(projectRoot, 'src');
        
        session.send(`⚙️ Initializing Pipeline in project space: \`${projectRoot}\``);

        // ==========================================
        // PHASE 1: THE ARCHITECT (High-Reasoning Qwen)
        // ==========================================
        session.send(`🧠 [1/3] ARCHITECT (\${this.config.architectModel}) generating logical code architecture...`);
        
        const architectPrompt = `
          You are a principal software architect. Your goal is to design a robust system for the following request: "\${prompt}".
          Break down the task, analyze architectural bottlenecks, and provide your verbose analytical reasoning trace.
          Then, produce ALL complete, production-ready source code files.
          Annotate your markdown file blocks explicitly like this: \````lang:filename.ext\````. Do not truncate.
        `;

        const architectResponse = await piAi.completion({
          provider: this.config.architectProvider,
          model: this.config.architectModel,
          prompt: architectPrompt,
          temperature: this.config.architectTemp,
          extra_body: {
            reasoning_effort: "xhigh",
            thinkingEnabled: true
          }
        });

        const fileMap = this.parseMarkdownCodeBlocks(architectResponse.text);
        if (Object.keys(fileMap).length === 0) {
          return session.send('❌ Pipeline aborted: The Architect failed to output properly structured files.');
        }

        // Writes source files dynamically into the active project's /src folder
        await this.writePipelineFiles(srcDir, fileMap);
        session.send(`📁 Codebase compiled! Written ${Object.keys(fileMap).length} source files to \`\${srcDir}\`.`);

        // ==========================================
        // PHASE 2: THE RUNNER (Zero-Reasoning Gemma)
        // ==========================================
        session.send(`🚀 [2/3] RUNNER (${this.config.runnerModel}) generating project validation test...`);
        
        const runnerPrompt = `
          You are a strict, rapid software execution script engineer. 
          Given this codebase layout: ${JSON.stringify(Object.keys(fileMap))}.
          Generate a standalone execution or validation script (e.g., in Node.js, Python, or Shell script) to run or verify this application.
          Do NOT explain your logic. Do NOT include verbose reasoning traces.
          Output ONLY the single executable file inside a standard markdown code block.
        `;

        const runnerResponse = await piAi.completion({
          provider: this.config.runnerProvider,
          model: this.config.runnerModel,
          prompt: runnerPrompt,
          temperature: this.config.runnerTemp,
          extra_body: { thinkingEnabled: false }
        });

        const testScriptCode = this.parseSingleCodeBlock(runnerResponse.text);
        const testFilename = this.detectScriptFilename(runnerResponse.text);
        const testFilePath = path.join(projectRoot, testFilename);
        
        // Write the verification script directly into the project root
        await this.ctx.fileSystem.write(testFilePath, testScriptCode);

        // ==========================================
        // PHASE 3: THE TESTER (Sandbox Automation Execution)
        // ==========================================
        session.send(`🧪 [3/3] TESTER spawning isolated shell runtime to verify build...`);
        
        try {
          const runCmd = testFilename.endsWith('.py') ? `python3 "${testFilePath}"` : `node "${testFilePath}"`;
          session.send(`🖥️ Executing terminal validation: \`${runCmd}\``);
          
          // Execute using the current dynamic project directory path context
          const execResult = await this.ctx.shell.execute(runCmd, { 
            timeout: this.config.testTimeoutMs,
            cwd: projectRoot 
          });
          
          if (execResult.code === 0) {
            session.send('✅ PIPELINE SUCCESS: Project built, linked, and passed runtime testing autonomously!');
          } else {
            session.send(`⚠️ RUNTIME FAILURE (Exit Code ${execResult.code}). Log traces:\n\`\`\`\n\${execResult.stderr || execResult.stdout}\n\`\`\``);
          }
        } catch (err) {
          session.send(`❌ Sandbox environmental execution block error: ${err.message}`);
        }
      });
  }

  parseMarkdownCodeBlocks(text) {
    const files = {};
    const regex = /```\w+\s*:\s*([\w./-]+)\n([\s\S]*?)```/g;
    let match;
    while ((match = regex.exec(text)) !== null) {
      files[match[1]] = match[2].trim();
    }
    if (Object.keys(files).length === 0) {
      const basicMatch = text.match(/```(?:\w+)?\n([\s\S]*?)```/);
      if (basicMatch) files['main_app.js'] = basicMatch[1].trim();
    }
    return files;
  }

  parseSingleCodeBlock(text) {
    const match = text.match(/```(?:\w+)?\n([\s\S]*?)```/);
    return match ? match[1].trim() : text;
  }

  detectScriptFilename(text) {
    if (text.includes('```python') || text.includes('.py')) return 'verify.py';
    return 'verify.js';
  }

  async writePipelineFiles(targetDir, fileMap) {
    for (const [filename, content] of Object.entries(fileMap)) {
      const fullPath = path.join(targetDir, filename);
      await this.ctx.fileSystem.write(fullPath, content);
    }
  }
}

GenericPipelinePlugin.Config = Schema.object({
  architectProvider: Schema.string().default('qwen_local'),
  architectModel: Schema.string().default('qwen38_27b_xhigh'),
  architectTemp: Schema.number().default(0.2),
  runnerProvider: Schema.string().default('ollama_local'),
  runnerModel: Schema.string().default('gemma4_12b'),
  runnerTemp: Schema.number().default(0.0),
  testTimeoutMs: Schema.number().default(600000),
});

module.exports = ProjectPipelinePlugin;

