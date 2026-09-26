Class Harbor.Installer Extends %RegisteredObject
{
ClassMethod Install() As %Status
{
    New $Namespace
    Set $Namespace = "%SYS"
    Set props("DispatchClass")="Harbor.Rest",props("NameSpace")="%SYS"
    Set props("AutheEnabled")=32,props("Enabled")=1,props("Resource")="%Admin_Operate"
    If ##class(Security.Applications).Exists("/api/harbor") {
        Quit ##class(Security.Applications).Modify("/api/harbor",.props)
    }
    Quit ##class(Security.Applications).Create("/api/harbor",.props)
}
}
