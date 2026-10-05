# LOGOS SEO Workflow Design

## 1. Document Information

| Item | Details |
|---|---|
| Project | LOGOS V1 Research Project |
| Domain | SEO Page Performance Analysis |
| Document Type | Business Workflow and Technical Design |
| Version | Draft v0.1 |
| Status | For review |

---

## 2. Purpose

The SEO system supports page-performance monitoring and analysis.

The system:

- Receives SEO data
- Standardizes the data
- Analyzes SEO performance
- Detects significant changes
- Creates SEO Anomalies
- Generates numerical summaries and comments
- Generates possible cause suggestions
- Suggests countermeasures
- Displays dashboards
- Provides weekly monitoring reports

The SEO team reviews the output and decides the necessary actions.

> The system generates a possible cause based on available data.  
> The SEO team reviews and confirms the cause.

---

## 3. Business Problem

The SEO team currently checks Google Search Console and GA4 data.

The team reviews changes in:

- Sessions
- Impressions
- Clicks
- CTR
- Average position
- Other agreed SEO metrics

The team then investigates possible causes and decides necessary actions.

The system should reduce manual analysis effort and provide consistent numerical information.

---

## 4. System Boundary

### System responsibility

- Data ingestion
- Data validation
- Data standardization
- Numerical analysis
- Significant-change detection
- SEO Anomaly creation
- Possible cause generation
- Countermeasure suggestion
- Dashboard generation
- Weekly monitoring report generation

### SEO team responsibility

- Review numerical results
- Review possible causes
- Confirm or reject the cause
- Decide necessary countermeasures
- Assign and implement actions where required
- Verify the result

### Important boundary

The system supports decision-making.

The system does not make the final SEO decision.

---

## 5. Main Workflow

```text
Receive SEO Data
      |
      v
Check and Standardize Data
      |
      v
Analyze SEO Performance
      |
      v
Detect Significant Change
      |
      +------------------------------+
      |                              |
      v                              v
Not Significant                 Significant
      |                              |
      v                              v
Continue Monitoring             Create SEO Anomaly
                                     |
                                     v
                              Generate Possible Cause
                                     |
                                     v
                              Generate Countermeasure
                              Suggestion
                                     |
                                     v
                              Generate Report
                              and Dashboard
                                     |
                                     v
                              Weekly Monitoring
                                     |
                                     v
                              System Work Ends
                                     |
                                     v
                              SEO Team Review
                                     |
                                     v
                              SEO Team Decision
```

---

## 6. Detailed Workflow

### Step 1: Receive SEO Data

**Purpose:** Receive SEO performance data for analysis.

**Input:**

- CSV file
- Excel file
- Page URL
- Analysis period
- GA4 data
- Google Search Console data

**System action:**

- Accept the file
- Read the data
- Check required columns
- Store the uploaded data

**Output:**

- Uploaded SEO dataset
- Upload status
- Data validation result

**PoC note:** CSV/Excel upload is used.

---

### Step 2: Check and Standardize Data

**Purpose:** Prepare consistent data for analysis.

**Input:**

- Uploaded SEO dataset

**System action:**

- Check column names
- Check date format
- Check page URLs
- Check units
- Check missing values
- Check duplicate records

**Output:**

- Standardized SEO dataset
- Data quality warnings

**Business rule:** Invalid or incomplete data must be reported.

---

### Step 3: Analyze SEO Performance

**Purpose:** Compare page performance between periods.

**Input:**

- Standardized SEO dataset
- Previous-period data
- Current-period data

**System action:**

- Compare sessions
- Compare impressions
- Compare clicks
- Compare CTR
- Compare average position
- Calculate absolute change
- Calculate percentage change

**Output:**

- SEO metric summary
- Page-level performance changes
- Numerical analysis

#### Core calculations

```text
Absolute Change = Current Value - Previous Value

Percentage Change =
(Current Value - Previous Value)
 / Previous Value × 100

CTR = Clicks / Impressions × 100
```

---

### Step 4: Detect Significant Change

**Purpose:** Find changes that require attention.

**Input:**

- SEO metric changes
- Business thresholds
- Page URL
- Analysis period

**System action:**

- Compare changes with configured thresholds
- Separate significant and non-significant changes
- Create an anomaly request for significant changes

**Output:**

- Significant-change result
- Monitoring result
- SEO Anomaly creation request

**Business rule:** Thresholds must be supplied or approved by the SEO team.

**Technical note:** Mechanical numeric rules and complex judgment rules must be separated.

---

### Step 5: Create SEO Anomaly

**Purpose:** Create a record for an important SEO performance change.

**Input:**

- Page URL
- Metric name
- Previous value
- Current value
- Change percentage
- Threshold
- Detection date

**System action:**

- Create an SEO Anomaly
- Save performance details
- Set status to `Detected`

**Output:**

- SEO Anomaly
- Related page and metric information
- Anomaly status

**Technical object:**

```text
SEOAnomaly
```

---

### Step 6: Generate Possible Cause

**Purpose:** Generate a possible explanation for the observed change.

**Input:**

- SEO Anomaly
- SEO metrics
- Previous and current values
- Available evidence
- Business judgment conditions

**System action:**

- Check numerical patterns
- Review available evidence
- Generate a possible cause
- Add supporting evidence
- Add confidence information

**Output:**

- Possible cause
- Analysis comment
- Supporting evidence
- Confidence level

**Important rule:**

> The system generates a possible cause based on available data.  
> The SEO team reviews and confirms the cause.

**Technical function:**

```text
SuggestCause
```

---

### Step 7: Generate Countermeasure Suggestion

**Purpose:** Suggest a possible action based on the observed problem.

**Input:**

- SEO Anomaly
- Possible cause
- Analysis comment
- Business judgment conditions

**System action:**

- Match the problem with available conditions
- Generate a countermeasure suggestion
- Explain the reason
- Set status to `Proposed`

**Output:**

- Countermeasure proposal
- Reason
- Related SEO Anomaly
- Status: `Proposed`

**Important rule:** The system suggests the action. The SEO team decides the actual action.

**Technical object:**

```text
Countermeasure
```

---

### Step 8: Generate Report and Dashboard

**Purpose:** Display SEO results in an easy-to-understand format.

**Input:**

- SEO analysis results
- Significant changes
- SEO Anomalies
- Cause comments
- Countermeasure suggestions

**System action:**

- Generate numerical summaries
- Display page performance
- Display changes and thresholds
- Display comments
- Display suggested countermeasures
- Display important pages

**Output:**

- SEO dashboard
- Analysis report
- Anomaly list
- Countermeasure suggestion list

---

### Step 9: Weekly Monitoring

**Purpose:** Provide regular SEO performance information.

**Input:**

- Latest SEO data
- Previous report
- Current analysis results
- Open SEO Anomalies

**System action:**

- Generate the weekly report
- Show new changes
- Show continuing problems
- Show resolved or unresolved items
- Show suggested next actions

**Output:**

- Weekly SEO monitoring report
- Updated dashboard
- Open item list

**PoC note:** Weekly reporting is included.

**Future note:** Higher-frequency monitoring may be implemented later.

---

### Step 10: SEO Team Review and Decision

**Purpose:** Allow the SEO team to decide the necessary action.

**Input:**

- Dashboard
- Weekly report
- SEO Anomaly
- Cause comment
- Countermeasure suggestion

**Human action:**

- Review numerical results
- Check the possible cause
- Confirm, reject, or modify the cause
- Decide the necessary countermeasure
- Assign the action if required

**Output:**

- Human decision
- Approved countermeasure
- Assigned action
- Monitoring decision

**System boundary:** The system supports the decision. The SEO team makes the final decision.

---

## 7. Dashboard Content

Recommended dashboard sections:

1. Overall SEO summary
2. Important page changes
3. Significant SEO Anomalies
4. Possible causes
5. Countermeasure suggestions
6. Weekly trends
7. Open and resolved items

Recommended metrics:

- Total pages analyzed
- Pages with significant changes
- Pages with decreased sessions
- Pages with increased sessions
- Open SEO Anomalies
- Countermeasure suggestions
- Resolved Anomalies

---

## 8. Weekly Report Content

```text
1. Report Information
2. Analysis Period
3. Data Source
4. Overall SEO Summary
5. Important Metric Changes
6. Significant SEO Anomalies
7. Numerical Analysis Comments
8. Possible Causes
9. Countermeasure Suggestions
10. SEO Team Decision
11. Open Monitoring Items
12. Data Quality Warnings
```

---

## 9. Technical Mapping

| Workflow Step | Technical Mapping |
|---|---|
| Receive SEO data | SourceBinding / CSV or Excel |
| Detect change | `DetectSignificantChange` |
| Check threshold | `IsChangeSignificant` |
| Create issue | `SEOAnomaly` |
| Generate cause | `SuggestCause` |
| Human confirmation | `RequiresHumanReview` |
| Countermeasure | `Countermeasure` |
| Dashboard/report | Typed Query / Report View |

---

## 10. Business Rules

1. A significant change is determined by an agreed business threshold.
2. Thresholds must be confirmed by the SEO team.
3. AI-generated causes are suggestions only.
4. Human review is required for uncertain or complex cases.
5. Numerical facts and possible interpretations must be shown separately.
6. Missing or invalid data must produce a warning.
7. The PoC must not automatically update website content.
8. The PoC must not automatically execute countermeasures.
9. Google-side logic changes may require additional investigation.
10. Report results must identify the source data and analysis period.

---

## 11. PoC Scope

### Included

- CSV/Excel upload
- Data standardization
- SEO analysis
- Significant-change detection
- SEO Anomaly creation
- AI-generated cause commentary
- Countermeasure proposal
- Numerical report
- Weekly report
- Dashboard view

### Not included

- Direct GA4 API connection
- Direct Google Search Console API connection
- Competitor crawling
- Competitor SEO scoring
- Automatic website updates
- Automatic countermeasure execution
- Full action workbench

---

## 12. Future Scope

### v1.0

- Direct GA4 connection
- Direct Google Search Console connection
- Higher-frequency monitoring
- Human review workbench
- Countermeasure tracking
- Action assignment
- Verification tracking

### v2.0

- Competitor website crawling
- Competitor SEO scoring
- AI-assisted page updates
- Human approval before website updates

---

## 13. Assumptions and Limitations

- CSV/Excel is the PoC data source.
- The input schema is not final until confirmed by the SEO team.
- Threshold values are not final until confirmed.
- AI output is a hypothesis or suggestion.
- The system does not replace SEO team judgment.
- Website changes require separate approval and implementation.
- The workflow may be extended after business review.

---

## 14. Final Scope Statement

The SEO system analyzes page performance data from CSV/Excel files, detects significant changes, creates SEO Anomalies, generates numerical summaries and possible cause comments, proposes countermeasures, and provides dashboards and weekly monitoring reports.

The system generates a possible cause based on available data. The SEO team reviews and confirms the cause.

The SEO team reviews the output and decides the necessary actions.

The PoC does not automatically update website content or execute countermeasures.
