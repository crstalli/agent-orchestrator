/**
 * DeepSeek Harness (dsh) Custom Engineering Plugin
 * Framework: Cordis Pure Functional Activation Block
 * File: index.js
 */

const fs = require('fs').promises;
const path = require('path');

module.exports.name = 'agent-orchestrator';

// CRITICAL FIX: 'base-commands' is the explicit platform service required to use ctx.command()
module.exports.inject = ['llm', 'shell', 'base-commands'];

module.exports.apply = function(ctx, config) {
  // Extract and compile runtime workspace preferences
  const cfg = {
    architectProvider: config.architectProvider || 'qwen_local',
    architectModel: config.architectModel || 'qwen38_27b_xhigh',
    runnerProvider: config.runnerProvider || 'ollama_local',
    runnerModel: config.runnerModel || 'gemma4_12b',
    testTimeoutMs: config.testTimeoutMs || 600000,
    maxRetries: config.maxRetries || 5,
    ...config
  };

  const logger = ctx.logger('agent-orchestrator');
  logger.info('Obsidian Project Plan Orchestrator Active.');

  // String extraction helpers
  const parseJsonBlock = (text) => {
    const jsonBlockRegex = /```json\s*([\s\S]*?)\s*```/;
    const fallbackRegex = /\{([\s\S]*?)\}/;
    const match = text.match(jsonBlockRegex) || text.match(fallbackRegex);
    if (match) {
      return match[0].replace(/```json|```/g, '').trim();
    }
    return text.trim();
  };

  const parseSingleCodeBlock = (text) => {
    const codeBlockRegex = /```(?:\w+)?\n([\s\S]*?)\s*```/;
    const match = text.match(codeBlockRegex);
    return match ? match[1].trim() : text.trim();
  };

  const generateObsidianMarkdown = (planData, originalPrompt) => {
    let md = '# 📅 Project Blueprint: ' + planData.projectName + '\n\n';
    md += '> **Original Prompt Goal:** ' + originalPrompt + '\n\n';
    md += '## 📋 Task List Checklist\n\n';
    md += 'Review your file dependencies below. If changes are needed, update `orchestrator_plan.json` directly, then type `/pipeline-start` inside the harness window to run.\n\n';

    planData.tasks.forEach(t => {
      md += '### 🟩 Task ID: ' + t.id + '\n';
      md += '- **Description:** ' + t.description + '\n';
      md += '- **Target Code File Location:** `' + t.targetFile + '`\n';
      md += '- **E2E Tester Target Script:** `' + t.verificationScript + '`\n';
      md += '- **Pre-requisite Dependencies:** ' + (t.dependencies && t.dependencies.length > 0 ? t.dependencies.map(d => '`' + d + '`').join(', ') : '_None_') + '\n';
      md += '- **Initial Setup Status:** `[ ] Pending Approval`\n\n';
    });

    md += '---\n*Generated automatically by DSH Agent Orchestrator Pipeline Plugin.*';
    return md;
  };

  const updateTaskStatus = async (planPath, taskId, status) => {
    const content = await fs.readFile(planPath, 'utf8');
    const plan = JSON.parse(content);
    const task = plan.tasks.find(t => t.id === taskId);
    if (task) task.status = status;
    await fs.writeFile(planPath, JSON.stringify(plan, null, 2), 'utf8');
  };

  const handleBackgroundFix = async (session, projectRoot, planPath, task, errorTrace) => {
    session.send('⚠️ Task ' + task.id + ' failed verification. Routing error back to Qwen for hotfix...');
    const fixPrompt = 'Your test script failed with trace:\n"' + errorTrace + '". Rewrite the structural contents of ' + task.targetFile + ' to resolve this. Output ONLY code.';
    
    const fixResponse = await ctx.llm.generate({
      provider: cfg.architectProvider,
      model: cfg.architectModel,
      prompt: fixPrompt,
      extra_body: { reasoning_effort: "xhigh", thinkingEnabled: true }
    });

    const cleanCode = parseSingleCodeBlock(fixResponse.text);
    await fs.writeFile(path.join(projectRoot, task.targetFile), cleanCode, 'utf8');
    await updateTaskStatus(planPath, task.id, 'pending');
  };

  const processTaskAsync = async (session, projectRoot, planPath, task) => {
    session.send('🚀 **Runner Engine** building file: `' + task.targetFile + '`...');

    const runnerPrompt = 'Write production code for: "' + task.description + '". Target Location: ' + task.targetFile + '. Output ONLY the code inside a code block.';
    const runnerResponse = await ctx.llm.generate({
      provider: cfg.runnerProvider,
      model: cfg.runnerModel,
      prompt: runnerPrompt,
      extra_body: { thinkingEnabled: false }
    });

    const cleanCode = parseSingleCodeBlock(runnerResponse.text);
    const absoluteTargetFile = path.join(projectRoot, task.targetFile);
    await fs.mkdir(path.dirname(absoluteTargetFile), { recursive: true });
    await fs.writeFile(absoluteTargetFile, cleanCode, 'utf8');

    const testPrompt = 'Write an automated validation script for ' + task.targetFile + '. Target Location: ' + task.verificationScript + '. Output ONLY executable code.';
    const testResponse = await ctx.llm.generate({
      provider: cfg.runnerProvider,
      model: cfg.runnerModel,
      prompt: testPrompt,
      extra_body: { thinkingEnabled: false }
    });

    const cleanTest = parseSingleCodeBlock(testResponse.text);
    const absoluteTestFile = path.join(projectRoot, task.verificationScript);
    await fs.mkdir(path.dirname(absoluteTestFile), { recursive: true });
    await fs.writeFile(absoluteTestFile, cleanTest, 'utf8');

    await updateTaskStatus(planPath, task.id, 'verifying');
    session.send('🧠 **Architect (' + cfg.architectModel + ')** validating runtime stability for `' + task.id + '` in background...');

    const runCmd = task.verificationScript.endsWith('.py') 
      ? 'python3 "' + absoluteTestFile + '"' 
      : 'node "' + absoluteTestFile + '"';

    try {
      const execResult = await ctx.shell.execute(runCmd, { timeout: cfg.testTimeoutMs, cwd: projectRoot });
      if (execResult.code === 0) {
        session.send('✅ Task ' + task.id + ' successfully verified!');
        await updateTaskStatus(planPath, task.id, 'verified');
      } else {
        const errorMsg = execResult.stderr || execResult.stdout || 'Execution crash.';
        await handleBackgroundFix(session, projectRoot, planPath, task, errorMsg);
      }
    } catch (err) {
      await updateTaskStatus(planPath, task.id, 'failed');
    }
  };

  const runBackgroundCycle = async (session, projectRoot, planPath) => {
    try {
      const planContent = await fs.readFile(planPath, 'utf8');
      const plan = JSON.parse(planContent);
      const verifiedTaskIds = plan.tasks.filter(t => t.status === 'verified').map(t => t.id);

      const nextTasks = plan.tasks.filter(t => 
        t.status === 'pending' && (!t.dependencies || t.dependencies.every(depId => verifiedTaskIds.includes(depId)))
      );

      if (nextTasks.length === 0) {
        const ongoing = plan.tasks.some(t => t.status === 'pending' || t.status === 'running' || t.status === 'verifying');
        if (!ongoing) {
          session.send('🎉 **Pipeline Execution Complete!** Every task has been verified successfully.');
        }
        return;
      }

      for (const task of nextTasks) {
        task.status = 'running';
        await fs.writeFile(planPath, JSON.stringify(plan, null, 2), 'utf8');
        processTaskAsync(session, projectRoot, planPath, task).then(() => {
          runBackgroundCycle(session, projectRoot, planPath);
        });
      }
    } catch (err) {
      logger.error('Error cycling plan blocks: ' + err.message);
    }
  };

  // 1. Register /pipeline
  ctx.command('pipeline <prompt:text>')
    .action(async ({ session }, prompt) => {
      if (!prompt) return 'Error: Please provide a generation prompt.';
      const projectRoot = session.cwd || process.cwd();
      const planPath = path.join(projectRoot, 'orchestrator_plan.json');
      const projectName = path.basename(projectRoot);
      const obsidianDir = '/mnt/f/ai/obsidian/projects';
      const obsidianMarkdownPath = path.join(obsidianDir, projectName + '-plan.md');

      session.send('📋 [1/3] Asking Architect (' + cfg.architectModel + ') to formulate blueprints...');

      const planPrompt = 'You are a principal software engineering coordinator. Analyze this prompt: "' + prompt + '".\n' +
        'You must create a highly detailed, step-by-step project plan that outlines files, tasks, and dependencies.\n' +
        'You must return ONLY a strictly valid JSON structure with NO conversation text wrapper.\n\n' +
        'Format layout:\n' +
        '{\n' +
        '  "projectName": "' + projectName + '",\n' +
        '  "tasks": [\n' +
        '    {\n' +
        '      "id": "task_1",\n' +
        '      "description": "Task details",\n' +
        '      "dependencies": [],\n' +
        '      "status": "pending",\n' +
        '      "targetFile": "src/module.js",\n' +
        '      "verificationScript": "tests/test_module.js"\n' +
        '    }\n' +
        '  ]\n' +
        '}';

      try {
        const architectResponse = await ctx.llm.generate({
          provider: cfg.architectProvider,
          model: cfg.architectModel,
          prompt: planPrompt,
          extra_body: { reasoning_effort: "xhigh", thinkingEnabled: true }
        });

        const cleanJsonText = parseJsonBlock(architectResponse.text);
        const planData = JSON.parse(cleanJsonText);

        await fs.mkdir(path.dirname(planPath), { recursive: true });
        await fs.writeFile(planPath, JSON.stringify(planData, null, 2), 'utf8');

        const markdownContent = generateObsidianMarkdown(planData, prompt);
        await fs.mkdir(obsidianDir, { recursive: true });
        await fs.writeFile(obsidianMarkdownPath, markdownContent, 'utf8');

        session.send('✨ **Formal Review Document Created!**');
        session.send('📓 **Obsidian Note Location:** `' + obsidianMarkdownPath + '`');
        session.send('🚀 When you are ready to approve, run: `/pipeline-start`');
      } catch (err) {
        session.send('❌ Failed to parse or generate plan files: ' + err.message);
      }
    });

  // 2. Register /pipeline-start
  ctx.command('pipeline-start')
    .action(async ({ session }) => {
      const projectRoot = session.cwd || process.cwd();
      const planPath = path.join(projectRoot, 'orchestrator_plan.json');
      try {
        await fs.access(planPath);
        session.send('⚙️ Plan approved! Handing execution tasks over to background workspace agents...');
        runBackgroundCycle(session, projectRoot, planPath);
      } catch (err) {
        session.send('❌ No plan file initialized yet. Run /pipeline [prompt] first.');
      }
    });

  // 3. Register /pipeline-status
  ctx.command('pipeline-status')
    .action(async ({ session }) => {
      const projectRoot = session.cwd || process.cwd();
      const planPath = path.join(projectRoot, 'orchestrator_plan.json');
      try {
        const planContent = await fs.readFile(planPath, 'utf8');
        const planData = JSON.parse(planContent);
        let summary = '📑 Project: ' + planData.projectName + '\n';
        
        planData.tasks.forEach(t => {
          const emoji = t.status === 'verified' ? '✅' : t.status === 'running' ? '🚀' : t.status === 'verifying' ? '🧠' : '⏳';
          summary += emoji + ' [' + t.status.toUpperCase() + '] ' + t.id + ': ' + t.description + ' (' + t.targetFile + ')\n';
        });
        
        return summary;
      } catch (err) {
        return "❌ No active workspace plan file found in this target directory path.";
      }
    });
};

