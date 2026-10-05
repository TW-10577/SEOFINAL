# SEO Ontology — Action, Object, Relation, State, Value Type

## 1. Action — what the system can do

### The workflow the system will support

Eight automated steps, one branch at step 4, then the SEO team reviews and decides before any action is taken.

| **Step** | **What happens**                   | **Result**                                                                          |SEO only or Shared
|----------|------------------------------------|-------------------------------------------------------------------------------------|--------------------------
| 1        | Receive SEO Data                   | CSV / Excel from GA4 and Search Console is accepted                                 |SEO Only
| 2        | Check and Standardize Data         | Fields validated, deduplicated and normalized; quality warnings raised              |SEO Only
| 3        | Analyze SEO Performance            | Sessions, impressions, clicks, CTR and ranking compared against the previous period |SEO Only
| 4        | Detect Significant Change          | Branch — see the two rows below                                                     |Shared
| 4a       | ↳ Not significant                  | No anomaly is created; the next weekly cycle repeats the check                      |Shared
| 4b       | ↳ Significant                      | An SEO Anomaly is created at status Detected, and steps 5 to 8 continue             |Shared
| 5        | Generate Possible Cause            | AI hypothesis with supporting evidence and confidence                               |Shared
| 6        | Generate Countermeasure Suggestion | A proposed action — not yet approved                                                |Shared
| 7        | Generate Report and Dashboard      | Numbers and suggestions shown side by side                                          |SEO Only
| 8        | Weekly Monitoring                  | Runs on schedule; system work ends here                                             |Shared
| H1       | SEO Team Reviews Output            | Report, dashboard, AI cause and countermeasure are read                             |SEO Only
| H2       | SEO Team Decides Action            | Cause confirmed; countermeasure approved, adjusted or dismissed                     |SEO Only
| H3       | Action Owned and Tracked           | Approved countermeasure is assigned, then the cycle returns to step 1               |Shared

## 2. System boundary

| **System responsibility**                                 | **SEO team responsibility**         |
|-----------------------------------------------------------|-------------------------------------|
| Data ingestion, validation and standardization            | Review the numerical results        |
| Numerical analysis and significant-change detection       | Review the possible cause           |
| SEO Anomaly creation                                      | Confirm or reject the cause         |
| Possible cause generation with evidence and confidence    | Decide the necessary countermeasure |
| Countermeasure suggestion                                 | Assign and implement the action     |
| Dashboard, report and weekly monitoring report generation | Verify the result                   |

## 3. Current PoC scope

| **In scope now (PoC)**                                 | **Not in the PoC**                               |
|--------------------------------------------------------|--------------------------------------------------|
| CSV / Excel upload of GA4 and Search Console exports   | Direct GA4 API connection                        |
| Data standardization and quality warnings              | Direct Search Console API connection             |
| SEO analysis and period comparison                     | Competitor site crawling                         |
| Significant-change detection against agreed thresholds | Competitor or own-page SEO scoring               |
| SEO Anomaly creation                                   | Automatic website updates                        |
| AI-generated cause commentary with evidence            | Automatic countermeasure execution               |
| Countermeasure proposal                                | Full action workbench                            |
| Numerical report, weekly report and dashboard          | Higher-frequency (daily or real-time) monitoring |

### How the workflow maps to the six ontology items

| **Workflow element**                                                                              | **Ontology item it produces** |
|---------------------------------------------------------------------------------------------------|-------------------------------|
| The nine workflow steps and who performs each                                                     | Action                        |
| The things each step reads or creates — query, page, data, anomaly, cause, countermeasure, report | Object                        |
| The physical links between them — query to page, anomaly to its evidence                          | Relation                      |
| The lifecycle of an anomaly and of a countermeasure                                               | State                         |
| The metrics, thresholds and status values themselves                                              | Value Type                    |
| The overall domain, data sources and boundary                                                     | Target Ontology               |

## 4. Target Ontology

The SEO ontology represents how SEO performance changes over time, how a significant change is identified against business judgment conditions, and how that change is explained and answered with a countermeasure.

| **Attribute**        | **Definition**                                                                                                                                                                                                                  |
|----------------------|---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| Ontology name        | SEO Page Performance Analysis Ontology                                                                                                                                                                                          |
| Domain               | E-commerce web traffic / SEO session analysis                                                                                                                                                                                   |
| Target               | SEO performance derived from Google Analytics 4 and Google Search Console data                                                                                                                                                  |
| Analysis unit        | Search Query and Page. Search Console is analysed at query level; GA4 at traffic-source and page level (ECM-04)                                                                                                                 |
| Comparison rule      | Current period against the previous period (week on week), plus surge and drop rate (ECM-04)                                                                                                                                    |
| Purpose              | Represent SEO metrics and their period-over-period change, detect significant change using business-defined judgment conditions, record the anomaly, hold the suggested cause and countermeasure, and support report generation |
| Data input (PoC)     | CSV / Excel files exported from GA4 and Search Console by the business side (ECM-05)                                                                                                                                            |
| Decision model       | Human-in-the-loop. The system suggests; the SEO team confirms, rejects or amends                                                                                                                                                |
| Out of this ontology | Sales LP analysis, competitor price and BTO configuration ontology, advertising portfolio ontology                                                                                                                              |

**Core story represented by the ontology:**

**Query / Page → SEO Data → SEO Anomaly → Cause Hypothesis → Countermeasure → Generated Report / View**

## 5. Action

Actions are the steps that actually occur in the workflow. "Performed by" shows whether the system or the SEO team owns the step.

| **#** | **Action**                 | **What it does**                                                                                                                               | **Performed by**          |
|--------|----------------------------|------------------------------------------------------------------------------------------------------------------------------------------------|---------------------------|
| A1     | Receive SEO Data           | Accept the GA4 / Search Console CSV or Excel file, with the target queries or pages and the analysis period                                    | SEO team uploads → System |
| A2     | Check and Standardize Data | Validate column names, date format, URL format, units, missing values and duplicates; raise a warning when the data is not usable              | System                    |
| A3     | Analyze SEO Performance    | Compare the current period against the previous period per analysis unit and per metric; calculate absolute change, change rate and surge rate | System                    |
| A4     | Detect Significant Change  | Evaluate each change against the judgment condition supplied by the business; separate significant from non-significant                        | System                    |
| A5     | Register SEO Anomaly       | Create an SEO Anomaly for each significant change, with the evidence values attached, at status Detected                                       | System                    |
| A6     | Propose Cause Hypothesis   | Suggest a possible cause from the available data and the business conditions, with supporting evidence and confidence                          | System (suggestion only)  |
| A7     | Propose Countermeasure     | Suggest a possible SEO or advertising countermeasure for the cause, at status Proposed                                                         | System (suggestion only)  |
| A8     | Review and Decide          | Confirm, reject or amend the cause; approve, adjust or dismiss the countermeasure; assign the action                                           | SEO team                  |
| A9     | Generate SEO Report        | Produce the aggregation, anomaly list, comments, and query ranking as a generated report/view output (ECM-04 request)                         | System                    |

### 5.1 Technical mapping of the actions

| **Action**                   | **Technical mapping**                        |
|------------------------------|----------------------------------------------|
| A1 Receive SEO Data          | SourceBinding — CSV / Excel                  |
| A4 Detect Significant Change | DetectSignificantChange, IsChangeSignificant |
| A5 Register SEO Anomaly      | SEOAnomaly                                   |
| A6 Propose Cause Hypothesis  | SuggestCause                                 |
| A7 Propose Countermeasure    | Countermeasure                               |
| A8 Review and Decide         | RequiresHumanReview                          |
| A9 Generate SEO Report       | Typed Query / Report View                    |

**Core calculations used in A3:**

- Absolute change = current value − previous value
- Percentage change = (current value − previous value) ÷ previous value × 100
- CTR = clicks ÷ impressions × 100

## 6. Object

Objects are the business entities that need to be represented and traced in the ontology. Intermediate calculated values and generated report/view outputs are not treated as persistent ontology objects.

| **#** | **Object**               | **Meaning**                                                                                                                             | **Main attributes**                                                                                            |
|--------|--------------------------|-----------------------------------------------------------------------------------------------------------------------------------------|----------------------------------------------------------------------------------------------------------------|
| O1     | Search Query             | A search keyword bringing traffic to the site — the Search Console unit of analysis                                                     | Query text, brand division, category division                                                                  |
| O2     | Page                     | A page of our e-commerce site that is monitored                                                                                         | Page URL, page title                                                                                           |
| O3     | Query Classification     | The brand division (own-brand or generic) and category division applied to a query. Fully manual today with no master database (ECM-04) | Classification type, classification value, rule or source                                                      |
| O4     | Traffic Source           | The inflow channel seen in GA4 — organic, paid, display and so on                                                                       | Channel name, channel group                                                                                    |
| O5     | Analysis Period          | The period analysed and the period it is compared against                                                                               | Start date, end date, granularity (weekly for the PoC)                                                         |
| O6     | SEO Data                 | One set of metric values for one analysis unit in one period                                                                            | Sessions, impressions, clicks, CTR, average position, conversions, CVR, data source, export condition          |
| O7     | Judgment Condition       | The business rule that decides whether a change is significant                                                                          | Metric, direction, threshold value, unit, condition name, condition type                                       |
| O8     | SEO Anomaly              | A significant change detected on one analysis unit and one metric                                                                       | Subject, metric, previous value, current value, change, change rate, condition applied, detection date, status |
| O9     | Cause Hypothesis         | A possible explanation for an anomaly                                                                                                   | Anomaly, hypothesis text, supporting evidence, confidence, review status                                       |
| O10    | Countermeasure           | A suggested SEO or advertising action answering the cause                                                                               | Cause, countermeasure text, reason, target query or page, status, decided by                                   |

## 6.1 Review change — generated outputs and calculated values

- **MetricChange** is not treated as a persistent ontology object. Absolute Change, Change Rate, and Surge/Drop Rate remain as calculated Value Types used for significant-change detection and anomaly creation.
- **SEO Report** and **Weekly Monitoring Report** are not treated as persistent ontology objects. They remain generated report/view outputs produced by the workflow.
- The report-generation Action and weekly monitoring workflow remain in scope; only the persistent Object representation was removed.

## 7. Relation

| **#** | **From**                 | **Relation**  | **To**               | **Meaning**                                       |
|--------|--------------------------|---------------|----------------------|---------------------------------------------------|
| R1     | Search Query             | HAS           | SEO Data             | A query holds its Search Console metric values    |
| R2     | Page                     | HAS           | SEO Data             | A page holds its GA4 metric values                |
| R3     | Search Query             | LANDS_ON      | Page                 | A query brings traffic to a page                  |
| R4     | Search Query             | CLASSIFIED_AS | Query Classification | Brand and category division of the query          |
| R5     | SEO Data                 | ATTRIBUTED_TO | Traffic Source       | GA4 values belong to an inflow channel            |
| R6     | SEO Data                 | MEASURED_IN   | Analysis Period      | Every metric set belongs to one period            |
| R7     | SEO Data                 | COMPARED_WITH | SEO Data             | Current period compared with the previous period  |
| R8     | SEO Anomaly              | DETECTED_ON   | Search Query / Page  | The anomaly belongs to a specific analysis unit   |
| R9     | SEO Anomaly              | BASED_ON      | SEO Data             | The metric values are the evidence of the anomaly |
| R10    | SEO Anomaly              | EVALUATED_BY  | Judgment Condition   | The rule that made the change significant         |
| R11    | Cause Hypothesis         | EXPLAINS      | SEO Anomaly          | A possible reason for the anomaly                 |
| R12    | Countermeasure           | ADDRESSES     | Cause Hypothesis     | The action answers the confirmed cause            |
| R13    | Countermeasure           | APPLIED_TO    | Search Query / Page  | The target the action is taken on                 |

## 8. State

Only SEO Anomaly and Countermeasure have a governed lifecycle — these are the points where the SEO team makes a decision. Every other object is descriptive and carries no lifecycle. The AI-generated cause carries a separate human-review status. The status names below are the ones defined in the SEO Workflow Design.

| **Object**                | **States**                                                                             | **Who changes the state**                                                      |
|---------------------------|----------------------------------------------------------------------------------------|--------------------------------------------------------------------------------|
| SEO Anomaly (governed)    | Detected → Triaged → CountermeasureAssigned → Resolved / Dismissed                     | The system creates it as Detected; the SEO team moves it forward               |
| Countermeasure (governed) | Proposed → Approved → InProgress → Completed → VerifiedEffective / VerifiedIneffective | The system creates it as Proposed; the SEO team approves, runs and verifies it |
| Human review status       | NotReviewed → Confirmed / Rejected / NeedsMoreEvidence                                 | Applied to the AI-generated cause; set by the SEO team                         |

> **Open dependency**
>
> The threshold values that move a change into Detected are not decided by us. They must be supplied or approved by the SEO team. The PoC never moves a Countermeasure past Approved automatically — the system does not execute countermeasures or update the website.

## 9. Value Type

| **Data item**               | **Value type**         | **Unit / format**                                                                      | **Note**                                 |
|-----------------------------|------------------------|----------------------------------------------------------------------------------------|------------------------------------------|
| Search query                | String                 | free text                                                                              | Primary key candidate for Search Query   |
| Brand division              | Enumeration            | own-brand / generic                                                                    | Values to be supplied by the business    |
| Category division           | Enumeration            | category master                                                                        | No master exists today — to be supplied  |
| Traffic source              | Enumeration            | organic / paid / display / other                                                       | GA4 channel grouping                     |
| Page URL                    | String                 | full URL                                                                               | Primary key candidate for Page           |
| Page title                  | String                 | —                                                                                      | Optional                                 |
| Analysis period             | Date range             | YYYY-MM-DD to YYYY-MM-DD                                                               | Weekly for the PoC                       |
| Sessions                    | Integer                | count                                                                                  | GA4                                      |
| Impressions                 | Integer                | count                                                                                  | Search Console                           |
| Clicks                      | Integer                | count                                                                                  | Search Console                           |
| CTR                         | Decimal (percentage)   | % — decimal places to be confirmed                                                     | Search Console                           |
| Average position            | Decimal                | rank, 1 decimal place                                                                  | Search Console                           |
| Conversions                 | Integer                | count                                                                                  | GA4 — confirm availability               |
| CVR                         | Decimal (percentage)   | %                                                                                      | GA4 — confirm availability               |
| Absolute change             | Integer / Decimal      | same unit as the metric                                                                | Intermediate calculated value; not persisted as an Object                               |
| Change rate                 | Decimal (percentage)   | %                                                                                      | Intermediate calculated value; not persisted as an Object — week on week                |
| Surge / drop rate           | Decimal (percentage)   | %                                                                                      | Intermediate calculated value; not persisted as an Object — basis to be confirmed       |
| Threshold value             | Decimal (percentage)   | %                                                                                      | Supplied by the business                 |
| Condition type              | Enumeration            | numeric / ambiguous                                                                    | Two groups requested in ECM-05           |
| Anomaly status              | Enumeration            | Detected / Triaged / CountermeasureAssigned / Resolved / Dismissed                     | See Section 8                            |
| Countermeasure status       | Enumeration            | Proposed / Approved / InProgress / Completed / VerifiedEffective / VerifiedIneffective | See Section 8                            |
| Human review status         | Enumeration            | NotReviewed / Confirmed / Rejected / NeedsMoreEvidence                                 | Applied to the cause                     |
| Confidence level            | Enumeration or decimal | to be confirmed                                                                        | Attached to the AI-generated cause       |
| Detection date / issue date | Date                   | YYYY-MM-DD                                                                             | —                                        |
| Cause text / comment        | String (long text)     | —                                                                                      | Generated, then reviewed by the SEO team |

## 10. Data required from the Retail / SEO team

The six items above cannot be finalised or implemented without the following. This is the request list for the business side. The right-hand column shows which of the six items each request unblocks.

### A. Data schema of the GA4 / Search Console export

| **#** | **What we need**                                                                                                                  | **Why**                                                                                                                    | **Unblocks**       |
|--------|-----------------------------------------------------------------------------------------------------------------------------------|----------------------------------------------------------------------------------------------------------------------------|--------------------|
| A1     | The exact column list of the GA4 export                                                                                           | To fix Object and Value Type                                                                                               | Object, Value Type |
| A2     | The exact column list of the Search Console export                                                                                | Same as above                                                                                                              | Object, Value Type |
| A3     | The unit and format of each column — count, %, decimal places, date format                                                        | To fix Value Type correctly                                                                                                | Value Type         |
| A4     | The extraction period and cycle — daily, weekly or monthly                                                                        | To fix Analysis Period and the comparison rule                                                                             | Object, Relation   |
| A5     | The filter and condition settings used when the file is exported                                                                  | ECM-04 notes the figures change with the export conditions; the definition must be fixed so everyone reads the same number | Value Type, Object |
| A6     | One real sample file (CSV or Excel) — test data is acceptable                                                                     | To validate the standardization step                                                                                       | All six            |
| A7     | Confirmation of who supplies the export — the GA4 account and API side sits with the E-commerce Business Promotion Dept. (ECM-04) | To fix the data hand-over route for the PoC                                                                                | Action             |

### B. Target scope of the analysis

| **#** | **What we need**                                                                  | **Why**                                                                                                        | **Unblocks**                 |
|--------|-----------------------------------------------------------------------------------|----------------------------------------------------------------------------------------------------------------|------------------------------|
| B1     | The list of pages to be analysed, or the rule for selecting them                  | To define the Page object correctly                                                                            | Object                       |
| B2     | Which metrics are actually used in the weekly review                              | To avoid modelling metrics nobody uses                                                                         | Object, Value Type           |
| B3     | The brand division and category division values, and the rule used to assign them | ECM-04 records this as fully manual with no master database — we need the values to model Query Classification | Object, Relation, Value Type |
| B4     | Whether the analysis unit is the query, the page, or both                         | To fix which object the anomaly attaches to                                                                    | Object, Relation             |

### C. Judgment conditions — highest priority

Requested in ECM-05. Please provide several examples in two groups.

| **#** | **What we need**                                                                                                         | **Why**                                                                 | **Unblocks**              |
|--------|--------------------------------------------------------------------------------------------------------------------------|-------------------------------------------------------------------------|---------------------------|
| C1     | Numeric and mechanical conditions that are clearly implementable — for example, sessions down more than X% week on week  | These become the Judgment Condition object and drive the Detected state | State, Object, Value Type |
| C2     | Complex or ambiguous conditions that would be good to have even if feasibility is unclear                                | To judge what is possible now and what must wait                        | Action, State             |
| C3     | The threshold value and direction for each condition                                                                     | Without this, significant change cannot be detected                     | State                     |
| C4     | How a site-wide change — for example a Google algorithm change — should be treated differently from a single-unit change | Raised in ECM-05; affects how conditions are evaluated                  | Action, State             |

### D. Cause and countermeasure knowledge

| **#** | **What we need**                                                           | **Why**                                               | **Unblocks**   |
|--------|----------------------------------------------------------------------------|-------------------------------------------------------|----------------|
| D1     | Typical causes the SEO team considers when a metric moves                  | To make the Cause Hypothesis suggestions realistic    | Object, Action |
| D2     | The list of SEO and advertising countermeasures actually taken in practice | To define the Countermeasure object                   | Object, State  |
| D3     | Who reviews an AI-suggested cause and who approves a countermeasure        | To fix the human-review and Countermeasure lifecycles | State, Action  |

### E. Report expectations

| **#** | **What we need**                                                                                      | **Why**                                                               | **Unblocks**       |
|--------|-------------------------------------------------------------------------------------------------------|-----------------------------------------------------------------------|--------------------|
| E1     | A sample of the current weekly SEO report                                                             | To match the output to existing practice                              | Object, Action     |
| E2     | The aggregation figures that must appear in the report                                                | To define the generated report/view contents                                     | Object, Value Type |
| E3     | The style and level of detail expected in the generated comments                                      | To set the commentary output                                          | Action             |
| E4     | How the query ranking should be sorted — week-on-week change, surge rate, or both — and how many rows | ECM-04 requests a ranking dashboard; this fixes the report definition | Action, Object     |
| E5     | Confirmation that weekly monitoring is sufficient for the PoC                                         | ECM-05 notes a wish for higher frequency; the PoC is scoped weekly    | Object, Action     |
