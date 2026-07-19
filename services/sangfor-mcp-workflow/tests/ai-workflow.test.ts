/**
 * AI Workflow Generator tests — in-process LM Studio fixture (U007).
 * No localhost:1234, no runtime skip(), no LM_STUDIO_TEST gate.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { LLMClient, getLLMClient, resetLLMClient } from '@sangfor/workflow-engine';
import { AIWorkflowGenerator } from '@sangfor/workflow-engine';
import { startLmStudioFixture, type LmStudioFixture } from './helpers/lm-studio-fixture.js';
import { probeLmStudio } from './helpers/lm-studio.js';

describe('LLM Client — LM Studio fixture contract', () => {
  let fixture: LmStudioFixture;
  let client: LLMClient;

  beforeAll(async () => {
    fixture = await startLmStudioFixture();
    resetLLMClient();
    client = getLLMClient({ baseUrl: fixture.baseUrl });
    const ok = await probeLmStudio(client);
    expect(ok).toBe(true);
  });

  afterAll(async () => {
    resetLLMClient();
    await fixture.close();
    expect(fixture.listenerCount()).toBe(0);
  });

  it('should connect to fixture health check', async () => {
    const isHealthy = await client.healthCheck();
    expect(isHealthy).toBe(true);
  });

  it('should list available models from fixture', async () => {
    const models = await client.listModels();
    expect(Array.isArray(models)).toBe(true);
    expect(models.length).toBeGreaterThan(0);
    expect(models[0].id).toBeDefined();
  });

  it('should get current model', async () => {
    const model = await client.getCurrentModel();
    expect(model).toBeTruthy();
    expect(model).not.toContain('embedding');
  });

  it('should test connection with simple prompt', async () => {
    const result = await client.testConnection();
    expect(result).toHaveProperty('available');
    expect(result).toHaveProperty('model');
    expect(result).toHaveProperty('latency');
    expect(typeof result.latency).toBe('number');
    expect(result.available).toBe(true);
  });

  it('should complete a simple chat request', async () => {
    const result = await client.chat(
      [{ role: 'user', content: 'Say "hello"' }],
      { maxTokens: 10 },
    );
    expect(result.choices.length).toBeGreaterThan(0);
  });

  it('should complete JSON request', async () => {
    const result = await client.completeJSON<{ greeting: string }>(
      'Return JSON: {"greeting": "hello"}',
      'You must respond with valid JSON only.',
    );
    expect(result.greeting).toBeDefined();
  }, 30_000);

  it('should surface fixture error responses', async () => {
    // Direct fetch against fixture error path
    const res = await fetch(`${fixture.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-fixture-error': '1',
      },
      body: JSON.stringify({
        model: 'fixture-model',
        messages: [{ role: 'user', content: 'x' }],
      }),
    });
    expect(res.status).toBe(500);
  });
});

describe('AIWorkflowGenerator — AI 기반 워크플로우 생성', () => {
  let fixture: LmStudioFixture;
  let generator: AIWorkflowGenerator;

  beforeAll(async () => {
    fixture = await startLmStudioFixture();
    resetLLMClient();
    generator = new AIWorkflowGenerator(undefined, { baseUrl: fixture.baseUrl });
    const ok = await probeLmStudio(generator.getLLMClient());
    expect(ok).toBe(true);
  });

  afterAll(async () => {
    resetLLMClient();
    await fixture.close();
    expect(fixture.listenerCount()).toBe(0);
  });

  it('should check LLM status', async () => {
    const status = await generator.checkLLMStatus();
    expect(status).toHaveProperty('available');
    expect(status).toHaveProperty('model');
    expect(status).toHaveProperty('latency');
  });

  it('should analyze input', async () => {
    const profile = await generator.analyzeInput({
      customerName: 'AI 테스트 고객',
      excelFilePath: './test-data/checklist.xlsx',
      requirements: ['URL 필터링 설정', 'USB 정책 적용'],
    });

    expect(profile.customerName).toBe('AI 테스트 고객');
    expect(profile.products).toBeDefined();
    expect(profile.requirements.length).toBe(2);
  });

  it('should generate workflow with AI against fixture', async () => {
    generator.setUseAI(true);

    const profile = await generator.analyzeInput({
      customerName: 'AI 생성 테스트',
      excelFilePath: './test-data/checklist.xlsx',
      requirements: ['URL 필터링 설정', '스캐너 캡처'],
    });

    const workflow = await Promise.race([
      generator.generateWorkflow(profile),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('workflow generate timeout')), 25_000),
      ),
    ]);

    expect(workflow.reasoning).toBeDefined();
    expect(workflow.steps.length).toBeGreaterThan(0);
  }, 30_000);

  it('should fallback to rules when AI is disabled', async () => {
    generator.setUseAI(false);

    const profile = await generator.analyzeInput({
      customerName: '규칙 기반 테스트',
      excelFilePath: './test-data/checklist.xlsx',
      requirements: ['URL 필터링 설정'],
    });

    const workflow = await generator.generateWorkflow(profile);

    expect(workflow.reasoning).toContain('규칙 기반');
    expect(workflow.steps.length).toBeGreaterThan(0);
  });

  it('should fallback to rules when fixture is closed (offline)', async () => {
    resetLLMClient();
    const offline = await startLmStudioFixture();
    const offlineUrl = offline.baseUrl;
    await offline.close();
    const offlineGenerator = new AIWorkflowGenerator(undefined, {
      baseUrl: offlineUrl,
    });

    const profile = await offlineGenerator.analyzeInput({
      customerName: '오프라인 테스트',
      excelFilePath: './test-data/checklist.xlsx',
      requirements: ['URL 필터링 설정'],
    });

    const workflow = await offlineGenerator.generateWorkflow(profile);

    expect(workflow.reasoning).toContain('규칙 기반');
    expect(workflow.steps.length).toBeGreaterThan(0);
  });
});
