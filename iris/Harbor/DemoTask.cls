/// Safe integration-test task. Writes a timestamp only to the Harbor demo global.
Class Harbor.DemoTask Extends %SYS.Task.Definition
{
/// Test-only worker. Never started by the portal automatically.
ClassMethod Worker()
{
    Set ^HarborDemo("workerPid")=$JOB
    Hang 120
}
Parameter TaskName = "Harbor demonstration task";
Method OnTask() As %Status
{
    Set ^HarborDemo("lastRun")=$ZDATETIME($HOROLOG,3)
    Quit $$$OK
}
}
