// The ONLY tool in the whole AI tree with a server-side `execute`. Every other tool is a
// proposal the client applies behind the human Apply gate.

const { runWebSearch } = require('../shared/webSearch');

module.exports = {
  web_search: {
    description: 'Search the web for anything that benefits from real-world or up-to-date knowledge — survey best practices, example questions, industry standards, statistics, definitions, current events, how-to guides, product research, or any factual question. Search FIRST, then answer using the returned passages and cite naturally. Do NOT search for pure survey mutations (add field, rename, reorder, delete).',
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Concise, specific search query, e.g. "best NPS survey questions", "how to write employee satisfaction survey", "what is Net Promoter Score".',
        },
      },
      required: ['query'],
      additionalProperties: false,
    },
    // Runs the full retrieval pipeline (rewrite → discover → crawl → chunk → rank).
    execute: ({ query }) => runWebSearch({ query }),
  },
};
