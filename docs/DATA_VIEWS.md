# Reading and editing native API data

REST Explorer opens a structured response view. Record arrays support search, sortable columns, pages of 20 records and a record inspector. The table chooses up to six columns from the first 100 records; the inspector exposes the other returned fields. Search covers nested values as well as displayed columns.

Objects use labeled fields. Nested objects open on demand and scalar arrays appear as lists. Each level displays at most 100 entries and the viewer stops at depth six. These are display limits, not a promise that the native response contains the entire instance. The optional Raw API response disclosure previews at most 100,000 characters. Save response exports all data returned to the portal, subject to server-side masking and native API limits.

Configuration editors use typed nested controls. Object/array sections open on demand; closing and reopening a section preserves edited values. Add setting follows the native schema when available, with named key/value controls for free-form objects. The editor supports up to 100 entries per collection and eight nested levels; data beyond these limits remains in the form without being rendered. Existing native configuration remains subject to IRIS validation. Review changes shows labeled before/after values and hides secrets. Empty text is distinguished from an absent value. Task suspension is described as Paused or Scheduled.

Captured host data shows memory and disk used/available/total values with GiB/MiB switching. CPU load averages describe runnable or waiting processes; a single CPU-counter sample is not current CPU utilization. Metrics describe the host visible to IRIS, not container quotas. Missing or inconsistent capacity samples are labeled unavailable.

Captured log and API-console messages support text search and word-based classification. The classification is a reading aid, not the native severity code. The view displays at most 500 matching lines; bounded excerpts are labeled. Health data explicitly reports monitor freshness and offers a filter for checks not reported as Normal.

See [the nested mobile editor](images/editor-mobile.png).
