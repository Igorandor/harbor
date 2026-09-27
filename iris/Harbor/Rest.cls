Class Harbor.Rest Extends %CSP.REST
{
Parameter CHARSET = "utf-8";
Parameter UseSession = 0;
XData UrlMap
{
<Routes>
  <Route Url="/telemetry" Method="GET" Call="Telemetry" />
  <Route Url="/logs" Method="GET" Call="Logs" />
  <Route Url="/log-catalog" Method="GET" Call="LogCatalog" />
  <Route Url="/log-window" Method="GET" Call="LogWindow" />
</Routes>
}
ClassMethod OnPreDispatch(pUrl As %String, pMethod As %String, ByRef pContinue As %Boolean) As %Status
{
    Set pContinue = 1
    If '$SYSTEM.Security.Check("%Admin_Operate","USE") {
        Set %response.Status = "403 Forbidden", pContinue = 0
        Write "{""error"":""Requires %Admin_Operate:USE""}"
    }
    Quit $$$OK
}
ClassMethod Telemetry() As %Status
{
    Set %response.ContentType = "application/json"
    Write ##class(Harbor.Telemetry).Read()
    Quit $$$OK
}
ClassMethod Logs() As %Status
{
    Set %response.ContentType = "application/json"
    Set source = $Get(%request.Data("source",1),"messages")
    If (source'="messages")&&(source'="alerts") {
        Set %response.Status = "400 Bad Request"
        Write "{""error"":""Unknown log source""}"
        Quit $$$OK
    }
    Write ##class(Harbor.Telemetry).Logs(source,+$Get(%request.Data("limit",1),200))
    Quit $$$OK
}
ClassMethod LogCatalog() As %Status
{
    Set %response.ContentType = "application/json"
    Write ##class(Harbor.LogReader).Catalog()
    Quit $$$OK
}
ClassMethod LogWindow() As %Status
{
    Set %response.ContentType = "application/json"
    Set result=##class(Harbor.LogReader).Window($Get(%request.Data("file",1)), $Get(%request.Data("offset",1)), $Get(%request.Data("snapshot",1)), $Get(%request.Data("identity",1)), +$Get(%request.Data("limit",1),200))
    Set parsed={}.%FromJSON(result)
    If parsed.%IsDefined("status") {
        Set %response.Status=parsed.status_" Log request rejected"
    }
    Write result
    Quit $$$OK
}
}
