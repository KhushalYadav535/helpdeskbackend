/**
 * Analyze call transcript to categorize leads and determine actions
 */

interface AnalysisResult {
  category: "sales-lead" | "service-request" | "support" | "other";
  confidence: number;
  keywords: string[];
  sentiment: "positive" | "neutral" | "negative";
  intent: string;
  suggestedAction: string;
}

// Keywords for different categories
const SALES_KEYWORDS = [
  "buy", "purchase", "price", "cost", "quote", "quote", "pricing", "discount",
  "deal", "offer", "interested", "product", "service", "demo", "trial",
  "sales", "sell", "order", "invoice", "payment", "billing", "subscription",
  "package", "plan", "upgrade", "new customer", "sign up", "register"
];

const SERVICE_KEYWORDS = [
  "issue", "problem", "error", "bug", "broken", "not working", "fix", "repair",
  "help", "support", "complaint", "complaint", "technical", "troubleshoot",
  "down", "outage", "slow", "failed", "cannot", "unable", "stuck", "blocked"
];

const SUPPORT_KEYWORDS = [
  "question", "how to", "how do", "explain", "understand", "guide", "tutorial",
  "documentation", "help", "assistance", "information", "details", "clarify"
];

// Sentiment keywords
const POSITIVE_KEYWORDS = [
  "great", "excellent", "good", "amazing", "wonderful", "perfect", "love", "happy",
  "satisfied", "pleased", "thank", "appreciate", "fantastic", "awesome"
];

const NEGATIVE_KEYWORDS = [
  "bad", "terrible", "awful", "horrible", "hate", "angry", "frustrated", "disappointed",
  "upset", "complaint", "refund", "cancel", "unhappy", "dissatisfied"
];

export function analyzeTranscript(transcript: string): AnalysisResult {
  if (!transcript || transcript.trim().length === 0) {
    return {
      category: "other",
      confidence: 0,
      keywords: [],
      sentiment: "neutral",
      intent: "unknown",
      suggestedAction: "Review manually",
    };
  }

  const lowerTranscript = transcript.toLowerCase();
  const words = lowerTranscript.split(/\s+/);
  
  // Count keyword matches
  let salesScore = 0;
  let serviceScore = 0;
  let supportScore = 0;
  let positiveScore = 0;
  let negativeScore = 0;
  
  const foundKeywords: string[] = [];

  // Check for sales keywords
  SALES_KEYWORDS.forEach((keyword) => {
    if (lowerTranscript.includes(keyword)) {
      salesScore++;
      foundKeywords.push(keyword);
    }
  });

  // Check for service keywords
  SERVICE_KEYWORDS.forEach((keyword) => {
    if (lowerTranscript.includes(keyword)) {
      serviceScore++;
      foundKeywords.push(keyword);
    }
  });

  // Check for support keywords
  SUPPORT_KEYWORDS.forEach((keyword) => {
    if (lowerTranscript.includes(keyword)) {
      supportScore++;
      foundKeywords.push(keyword);
    }
  });

  // Check sentiment
  POSITIVE_KEYWORDS.forEach((keyword) => {
    if (lowerTranscript.includes(keyword)) {
      positiveScore++;
    }
  });

  NEGATIVE_KEYWORDS.forEach((keyword) => {
    if (lowerTranscript.includes(keyword)) {
      negativeScore++;
    }
  });

  // Determine category
  let category: "sales-lead" | "service-request" | "support" | "other" = "other";
  let confidence = 0;
  let intent = "unknown";
  let suggestedAction = "Review manually";

  const totalScore = salesScore + serviceScore + supportScore;
  
  if (totalScore === 0) {
    category = "other";
    confidence = 0.3;
    intent = "unclear";
    suggestedAction = "Review manually - no clear intent detected";
  } else if (salesScore >= serviceScore && salesScore >= supportScore) {
    category = "sales-lead";
    confidence = Math.min(0.9, 0.5 + (salesScore / 10));
    intent = "purchase or inquiry";
    suggestedAction = "Create CRM lead and assign to sales team";
  } else if (serviceScore >= supportScore) {
    category = "service-request";
    confidence = Math.min(0.9, 0.5 + (serviceScore / 10));
    intent = "resolve issue or problem";
    suggestedAction = "Create HelpDesk ticket and assign to support";
  } else {
    category = "support";
    confidence = Math.min(0.9, 0.5 + (supportScore / 10));
    intent = "get information or guidance";
    suggestedAction = "Create HelpDesk ticket for support";
  }

  // Determine sentiment
  let sentiment: "positive" | "neutral" | "negative" = "neutral";
  if (positiveScore > negativeScore && positiveScore > 0) {
    sentiment = "positive";
  } else if (negativeScore > positiveScore && negativeScore > 0) {
    sentiment = "negative";
  }

  return {
    category,
    confidence: Math.round(confidence * 100) / 100,
    keywords: [...new Set(foundKeywords)], // Remove duplicates
    sentiment,
    intent,
    suggestedAction,
  };
}

