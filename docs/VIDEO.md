# Video publication kit

## Status

An English narrated video and subtitles have been prepared locally as `harbor-walkthrough.mp4` and `harbor-walkthrough.srt`. They are delivered separately from the source repository. No YouTube URL is available yet, and no video bonus is claimed. A combined three-project film is also available in the delivery bundle.

The video is an edited sequence of actual application screens, with offline synthesized English narration. It is not a continuous screen recording. Native IRIS operations in the shown workflow are reads; demonstration workflow records were saved in a separate temporary gateway store. Screens contain bundled instance data, not a production customer's records.

## Suggested YouTube title

Harbor for InterSystems IRIS | Guided product walkthrough

## Suggested description

Inspect a scheduled task, preserve its evidence in an investigation, and record an operations-review note in Harbor for InterSystems IRIS.

This is an edited, narrated walkthrough of actual application screens. It uses synthesized English narration and English subtitles. The demonstrated workflow reads a running IRIS Community instance; it does not perform native administrative changes.

Source and installation: https://github.com/YOUR_GITHUB_ACCOUNT/harbor

Companion article: add the published Developer Community URL.

Open Exchange: add the published application URL.

## Before upload

1. Watch the complete MP4 and review the English subtitles. Replace the repository owner and add the real article/application links in the description.
2. Upload the individual video, or use the relevant chapter of the combined video. Review YouTube's requested publication settings yourself. Do not assume multiple uploads multiply the contest bonus.
3. Add the SRT as English captions if desired; readable captions are already burned into the prepared picture. Check for duplicate displayed captions when previewing.
4. Publish the chosen video, verify that viewers can open it, and add its actual URL to the Open Exchange YouTube field and this repository's README. A local MP4 alone is not a published contest video.

## Scene transcript

### 1. Start with the evidence

Harbor is an administration workspace for InterSystems IRIS. This guided walkthrough uses actual application screens from a running IRIS Community instance. The overview keeps missing monitor data visible. Here the system monitor is not configured, so Harbor does not present its counters as current measurements.

### 2. Inspect the task before acting

Open Task center and select Security Scan. The detail view separates scheduling state, task configuration, and source availability. It also highlights settings worth reviewing. Inspecting this task does not run it, suspend it, or change its schedule.

### 3. Read a bounded history

Execution history shows one returned successful execution in this sample. Filters, duration statistics, and exports apply to the returned records. An empty or bounded history does not prove that other executions never happened. The next step is to retain the evidence behind a review.

### 4. Give the investigation a concrete question

Create an investigation with a title, a question, severity, and tags. In this example, the goal is to retain task evidence before an operations review. This saves a Harbor workflow record in a separate demonstration workspace. It does not change native IRIS configuration.

### 5. Choose the sources to capture

In Captures, name the observation and select the relevant sources. Here the selection includes instance identity, system health, host capacity, recent messages, task definitions, and task history. Capture selected sources reads these inputs and preserves their individual outcomes.

### 6. Keep source outcomes with the capture

The saved capture records when it was collected and which sources were available. Future observations can be compared with this evidence. Missing sources must remain gaps in the review, rather than becoming reassuring empty values. The original operational data is retained with the investigation.

### 7. Record the conclusion and next action

Finally, add a note explaining what was checked. The timeline keeps that reasoning next to the capture, and the investigation can be exported as a report. No native settings were changed in this walkthrough. The repository README covers Docker installation, and the companion article explains the investigation workflow.
