const sanitizeHtml = require('sanitize-html');

/**
 * Strips ALL HTML tags. Use for plain text fields like comments, feedback, question titles.
 */
const stripAllHtml = (str) => {
  if (typeof str !== 'string') return str;
  return sanitizeHtml(str, {
    allowedTags: [],
    allowedAttributes: {},
  }).trim();
};

/**
 * Allows a safe HTML subset for rich text fields like posts, survey descriptions, affiliate link descriptions.
 * Permits formatting tags but strips scripts, iframes, event handlers, etc.
 */
const sanitizeRichText = (str) => {
  if (typeof str !== 'string') return str;
  return sanitizeHtml(str, {
    allowedTags: [
      'b', 'i', 'em', 'strong', 'a', 'p', 'br', 'ul', 'ol', 'li',
      'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'blockquote', 'code', 'pre',
      'span', 'div', 'img', 'hr', 'table', 'thead', 'tbody', 'tr', 'th', 'td',
      'u', 's', 'sub', 'sup',
    ],
    allowedAttributes: {
      'a': ['href', 'title', 'target', 'rel'],
      'img': ['src', 'alt', 'width', 'height'],
      'span': ['style'],
      'div': ['style'],
      'td': ['colspan', 'rowspan'],
      'th': ['colspan', 'rowspan'],
    },
    allowedSchemes: ['http', 'https', 'mailto'],
    allowedStyles: {
      '*': {
        'color': [/.*/],
        'background-color': [/.*/],
        'text-align': [/^(left|right|center|justify)$/],
        'font-size': [/.*/],
        'font-weight': [/.*/],
      },
    },
  }).trim();
};

module.exports = { stripAllHtml, sanitizeRichText };
