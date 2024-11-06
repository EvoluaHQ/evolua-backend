import { PRFileChanges } from "./github";

export interface AIResponse {
  summary: {
    total_issues: number;
    risk_levels: {
      critical: number;
      high: number;
      medium: number;
      low: number;
    };
  };
  issues: Array<{
    id: string;
    type: "vulnerability" | "code_quality" | "best_practice";
    risk_level: "critical" | "high" | "medium" | "low";
    title: string;
    location: {
      line_start: number;
      line_end: number;
    };
    description: string;
    impact: string;
    recommendation: {
      description: string;
      code: string;
    };
    cwe_id?: string;
    references?: {
      standard: string;
      rule_id: string;
    };
  }>;
}

/**
 * Interface for issue references (standards, rules, etc.)
 */
export interface IssueReference {
  standard: string; // e.g., "OWASP", "CERT", "ISO-27001"
  ruleId: string; // e.g., "A1:2021", "MSC21-C"
}

/**
 * Interface for issue location in code
 */
export interface IssueLocation {
  lineStart: number;
  lineEnd: number;
}

/**
 * Enum for possible risk levels
 */
export type RiskLevel = "critical" | "high" | "medium" | "low";

/**
 * Enum for issue types
 */
export type IssueType = "vulnerability" | "code_quality" | "best_practice";

export type Recommendation = {
  description: string;
  code?: string;
};

/**
 * Interface for a single code analysis issue
 */
export interface CodeIssue {
  id: string;
  type: IssueType;
  riskLevel: RiskLevel;
  title: string;
  location: IssueLocation;
  description: string;
  impact?: string;
  recommendation?: Recommendation;
  cweId?: string;
  references?: IssueReference;
}

export interface Summary {
  totalIssues: number;
  riskLevels: {
    critical: number;
    high: number;
    medium: number;
    low: number;
  };
}

export interface Findings {
  summary: Summary;
  issues: CodeIssue[];
}

export interface AnalysisResult {
  file: PRFileChanges;
  findings: Findings;
}

export interface ReviewStats {
  path: string;
  changes: number;
  issues: number;
}

export interface ReviewSummary extends Summary {
  files: ReviewStats[];
  keyFindings: string[];
}
