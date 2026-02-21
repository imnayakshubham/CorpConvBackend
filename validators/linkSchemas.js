const { z } = require('zod');

const mongoId = z.string().regex(/^[a-fA-F0-9]{24}$/, 'Invalid ID format');

const createLinkBody = z.object({
  url: z.string().url('Invalid URL').max(2000),
  category: z.string().min(2).max(50),
}).strict();

const updateLinkBody = z.object({
  link_id: mongoId,
  url: z.string().url().max(2000).optional(),
  category: z.string().min(2).max(50).optional(),
  title: z.string().max(200).optional(),
  description: z.string().max(500).optional(),
}).strict();

const deleteLinkBody = z.object({
  link_id: mongoId,
}).strict();

const likeBookmarkBody = z.object({
  link_id: mongoId,
}).strict();

const trackBody = z.object({
  link_id: mongoId,
}).strict();

const createAffiliateLinkBody = z.object({
  url: z.string().url('Invalid URL').max(2000),
  category: z.string().min(2).max(50),
  title: z.string().max(200).optional(),
  description: z.string().max(500).optional(),
  rich_description: z.string().max(10000).optional(),
  campaign: z.string().max(100).optional(),
  tags: z.array(z.string().max(30)).max(20).optional(),
  referral_enabled: z.boolean().optional(),
}).strict();

const updateAffiliateLinkBody = z.object({
  link_id: mongoId,
  url: z.string().url().max(2000).optional(),
  category: z.string().min(2).max(50).optional(),
  title: z.string().max(200).optional(),
  description: z.string().max(500).optional(),
  rich_description: z.string().max(10000).optional(),
  campaign: z.string().max(100).optional(),
  tags: z.array(z.string().max(30)).max(20).optional(),
  referral_enabled: z.boolean().optional(),
}).strict();

const fetchLinksQuery = z.object({
  user_id: mongoId.optional(),
  category: z.string().max(50).optional(),
  campaign: z.string().max(100).optional(),
  tag: z.string().max(30).optional(),
}).passthrough();

const linkIdParam = z.object({
  id: mongoId,
});

const slugParam = z.object({
  slug: z.string().min(1).max(50),
});

module.exports = {
  createLinkBody,
  updateLinkBody,
  deleteLinkBody,
  likeBookmarkBody,
  trackBody,
  createAffiliateLinkBody,
  updateAffiliateLinkBody,
  fetchLinksQuery,
  linkIdParam,
  slugParam,
};
