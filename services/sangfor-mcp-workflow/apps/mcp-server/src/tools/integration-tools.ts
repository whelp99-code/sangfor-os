import { parseExcelFile } from '@sangfor/workflow-engine';
import { searchObsidianNotes } from '@sangfor/wiki-sync';
import { denyWorkflowMutation } from '../../../../packages/shared/src/mutation-policy.js';
import type { ToolDefinition, WorkflowToolContext } from '../tool-types.js';

function requiredString(args: Readonly<Record<string, unknown>>, key: string): string {
  const value = args[key];
  if (typeof value !== 'string' || value.length === 0) {
    throw new TypeError(`${key} is required`);
  }
  return value;
}

function optionalString(args: Readonly<Record<string, unknown>>, key: string): string | undefined {
  const value = args[key];
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function stringArray(args: Readonly<Record<string, unknown>>, key: string): string[] {
  const value = args[key];
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : [];
}

export function createIntegrationTools(
  context: WorkflowToolContext,
): Readonly<Record<string, ToolDefinition>> {
  return {
    get_mcp_status: {
      description: 'Read the protected workflow MCP child status.',
      inputSchema: { type: 'object', properties: {} },
      handler: () => ({
        connected: context.runtime.ready,
        toolsCount: context.toolRegistry.listTools().length,
      }),
    },
    list_mcp_tools: {
      description: 'List safe tools exposed by the protected MCP child.',
      inputSchema: { type: 'object', properties: {} },
      handler: () => context.toolRegistry.listSafeTools().map((tool) => ({
        name: tool.name,
        description: tool.description,
        category: tool.category,
        tags: tool.tags,
      })),
    },
    run_health_check: {
      description: 'Run a device health check when external access containment permits it.',
      inputSchema: {
        type: 'object',
        properties: { product: { type: 'string' }, targetUrl: { type: 'string' } },
        required: ['product'],
      },
      handler: () => denyWorkflowMutation('live_device_health_check'),
    },
    run_auto_wiki_pipeline: {
      description: 'Run the wiki pipeline when external sync containment permits it.',
      inputSchema: {
        type: 'object',
        properties: { obsidianVaultPath: { type: 'string' }, autoApprove: { type: 'boolean' } },
        required: ['obsidianVaultPath'],
      },
      handler: () => denyWorkflowMutation('wiki_sync'),
    },
    search_obsidian_notes: {
      description: 'Search protected local Obsidian notes.',
      inputSchema: {
        type: 'object',
        properties: { vaultPath: { type: 'string' }, query: { type: 'string' } },
        required: ['vaultPath', 'query'],
      },
      handler: (args) => {
        const query = requiredString(args, 'query');
        const notes = searchObsidianNotes(requiredString(args, 'vaultPath'), query);
        return { query, results: notes.length, notes };
      },
    },
    parse_excel: {
      description: 'Parse an allowed spreadsheet path.',
      inputSchema: {
        type: 'object',
        properties: { filePath: { type: 'string' } },
        required: ['filePath'],
      },
      handler: (args) => parseExcelFile(
        context.validateFilePath(requiredString(args, 'filePath')),
      ),
    },
    compare_vendors: {
      description: 'Compare vendors in a category.',
      inputSchema: {
        type: 'object',
        properties: { category: { type: 'string' }, requirement: { type: 'string' } },
        required: ['category'],
      },
      handler: (args) => context.vendorComparator.compareByCategory(
        requiredString(args, 'category'),
        optionalString(args, 'requirement') ?? '',
      ),
    },
    compare_sangfor_vs_competitors: {
      description: 'Compare Sangfor with competitors in a category.',
      inputSchema: {
        type: 'object',
        properties: { category: { type: 'string' } },
        required: ['category'],
      },
      handler: (args) => context.vendorComparator.compareSangforVsCompetitors(
        requiredString(args, 'category'),
      ),
    },
    generate_comparison_report: {
      description: 'Generate a local comparison report.',
      inputSchema: {
        type: 'object',
        properties: {
          customerName: { type: 'string' },
          products: { type: 'array' },
          requirements: { type: 'array' },
        },
        required: ['customerName'],
      },
      handler: (args) => context.reportGenerator.generateComparisonReport({
        customerName: requiredString(args, 'customerName'),
        products: stringArray(args, 'products'),
        requirements: stringArray(args, 'requirements'),
        comparisonResults: [],
        recommendations: [],
      }),
    },
    generate_recommendation_doc: {
      description: 'Generate a local recommendation document.',
      inputSchema: {
        type: 'object',
        properties: {
          customerName: { type: 'string' },
          products: { type: 'array' },
          requirements: { type: 'array' },
        },
        required: ['customerName'],
      },
      handler: (args) => context.reportGenerator.generateRecommendationDoc({
        customerName: requiredString(args, 'customerName'),
        products: stringArray(args, 'products'),
        requirements: stringArray(args, 'requirements'),
        comparisonResults: [],
        recommendations: [],
      }),
    },
    generate_custom_guide: {
      description: 'Generate a local customer guide.',
      inputSchema: {
        type: 'object',
        properties: {
          customerName: { type: 'string' },
          products: { type: 'array' },
          requirements: { type: 'array' },
        },
        required: ['customerName'],
      },
      handler: (args) => context.reportGenerator.generateCustomGuide({
        customerName: requiredString(args, 'customerName'),
        products: stringArray(args, 'products'),
        requirements: stringArray(args, 'requirements'),
        comparisonResults: [],
        recommendations: [],
      }),
    },
    list_vendor_categories: {
      description: 'List protected vendor category metadata.',
      inputSchema: { type: 'object', properties: {} },
      handler: () => context.vendorDatabase.categories.map((category) => ({
        id: category.id,
        name: category.name,
        vendorCount: category.vendors.length,
        marketSize: category.marketSize,
        growthRate: category.growthRate,
      })),
    },
  } satisfies Record<string, ToolDefinition>;
}
