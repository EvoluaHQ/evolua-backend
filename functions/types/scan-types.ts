export interface PRFile {
  path: string
  content: string | null
}

export interface Finding {
  id: string
  type: "vulnerability" | "code_quality" | "best_practice"
  risk_level: "critical" | "high" | "medium" | "low"
  title: string
  location: {
    line_start: number
    line_end: number
  }
  description: string
  impact: string
  recommendation: string
  cwe_id?: string
  references?: {
    standard: string
    rule_id: string
  }
}

export interface AnalysisResults {
  summary: {
    total_issues: number
    risk_levels: {
      critical: number
      high: number
      medium: number
      low: number
    }
  }
  issues: Finding[]
}

export interface AnalysisResult {
  file: PRFile
  findings: AnalysisResults
}
