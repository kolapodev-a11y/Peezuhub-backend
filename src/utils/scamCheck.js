const { SCAM_KEYWORDS } = require('./constants');

function detectScamText(text = '') {
  const lower = text.toLowerCase();
  const hit = SCAM_KEYWORDS.find((keyword) => lower.includes(keyword));
  return hit || null;
}

module.exports = { detectScamText };
