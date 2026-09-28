# Investigate a task that appears to have missed a run

Use this walkthrough after the [quick start](../README.md#quick-start). You will inspect an existing task, save the evidence available now, and leave a report another operator can follow. No task is run, suspended or edited. Creating an investigation saves a Harbor record; it does not change IRIS configuration.

Choose a task you already know. On a fresh instance, use any existing task to practise inspecting its state; do not invent a failure when the evidence shows none.

## 1. Check the task and its recent executions

Open **Task center** and select the task name. Note its ID and namespace so similarly named tasks cannot be confused.

- In **Current state**, inspect scheduling, native status and source availability. An unavailable state is not evidence that a task stopped.
- In **Execution history**, inspect an execution's start, finish and outcome. The **History sample** selector allows up to 50, 100, 250 or 500 executions. Filters and duration statistics describe only the returned sample; an empty result does not prove the task never ran.
- In **Schedule & output**, compare the configured schedule with the time you expected the task to run.

Use **Export observation** to retain this task's configuration, state, history and collection metadata. This downloads a separate JSON file. Record the displayed collection time; **Refresh task** makes a new observation rather than preserving the old screen.

## 2. Save an investigation with the question still open

Open **Investigations → New investigation**. A useful title is `Check expected run of task #<ID>`. In **What needs investigation?**, write the expected execution time and time zone, the task ID, and what you actually observed. Use **information** severity for a practice review; use the operational impact to choose a severity for a real incident. Select **Create investigation**.

In **Captures**, enter a title such as `Initial check at 09:15 UTC`. Select **Instance identity**, **Task definitions**, **Recent task history** and **Recent system messages**, then **Capture selected sources**. Deselect unrelated defaults if they are not needed.

Open each source in the saved capture. Harbor distinguishes **collected**, **unavailable**, **pending** and **too large**. The capture is a set of separate observations, not an atomic snapshot. It requests at most 100 rows where supported, retains at most 100 recent message lines, and limits each source to 200,000 bytes. The task-history capture is a general recent window; it may omit the task you inspected in step 1.

This capture does not import the Task center observation. Keep that downloaded file with the final report and identify it in a note. Each investigation holds up to 12 captures.

## 3. Record a finding and the next check

In **Timeline → Add a note**, separate the observation from the conclusion. For example, fill in the actual values:

> Task #<ID>, namespace <namespace>. Expected run: <time and zone>. Latest returned execution: <start, finish, outcome>. Current native status at <collection time>: <status>. Missing evidence: <source or time range>. Next check: <specific action and owner>. Task observation file: <filename>.

Select **Save note**. If the question remains open, use **Status → New status → investigating**, give the reason, and **Save status**. If the available evidence answers the question, choose **resolved** and record why. Resolving a case records your assessment; it does not certify the task's business result.

If the response to **Save note** or **Capture selected sources** is lost or unreadable, the save may already have succeeded. Use **Refresh** inside the investigation, then inspect **Timeline** or the saved **Captures** before submitting again. Your entered text stays available, so clear it if the intended entry is already present. Refreshing reads the saved case; it does not repeat the append or collect another capture. A stale revision is refused by the server, but submitting again after a refresh deliberately creates a new entry.

For a later check, capture the same sources again while the case is open and use **Compare captures**. Check the **Earlier capture** and **Later capture** selections: numeric differences subtract the earlier selection from the later selection. Harbor warns beside the selectors if their finish times are reversed or equal; it does not swap the captures. Disappearing entries in bounded history or log windows do not establish deletion. The [operational guide](OPERATIONS.md#investigate-a-change) explains saved difference reviews and their limits.

## 4. Hand over the evidence

Choose **Download report** for an HTML report or **Export investigation** for the saved case JSON. Open the HTML file in a browser to read or print it. Check its case ID, owner, instance, revision and update time before sharing. A previous resolution belongs to an earlier closure when the case has been reopened; use the current status and timeline to understand the remaining work. Review the notes and retained operational data before sharing. Include the separate task observation when it contains relevant details missing from the general capture.

Saved cases belong to the signed-in IRIS account and instance. Another account cannot open your case as a shared ticket; use the exported report for handover. Returning with the same account lets you reopen the retained investigation, subject to its current source permissions. If a resolved case disappears from the default list, change **Status** from **Active investigations** to **All investigations**.

If a change is refused, Harbor checks whether the case can still be read. When that check is temporarily unavailable, evidence and exports stay hidden; use **Check access again** to retry. A successful check restores the view and unsaved note. If access is denied or the case is gone, Harbor removes its cached view.

You should finish with a concrete question, timestamped evidence, the limits of what was checked, and one next action or a justified resolution.

For collection bounds and recovery, see [Operational workflows](OPERATIONS.md). The UI and source definitions are in [TaskCenter.tsx](../src/features/tasks/TaskCenter.tsx), [Investigations.tsx](../src/pages/Investigations.tsx) and [diagnostics.ts](../shared/diagnostics.ts).
