# Implementation provenance

Harbor's administration application was developed for this project. The InterSystems SysAdmin API JSON is a reference contract, not a supplied application template. Third-party libraries and notices are listed in [THIRD_PARTY.md](../THIRD_PARTY.md).

Earlier local versions of Access Atlas and the project now called Waypoint reused Harbor's custom general administration layer. Their current production implementations replaced that layer with independently authored architectures. Historical Git revisions and the attribution of retained security/native regression probes were preserved. Harbor itself does not import or require either project.

The diagnostic-bundle implementation was developed in this repository after a public contest comparison identified the usefulness of explicit evidence scope and partial results. Competitor code, UI designs and README text were not imported. The comparison materials remain outside this application repository.
