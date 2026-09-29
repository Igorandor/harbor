Class Harbor.PackageInstaller Extends %RegisteredObject
{
/// Refuse to take over an existing route owned by another class or namespace.
ClassMethod Validate() As %Status
{
    Set targetNamespace=$Namespace
    New $Namespace
    Set $Namespace="%SYS"
    If ##class(Security.Applications).Exists("/api/harbor") {
        Set sc=##class(Security.Applications).Get("/api/harbor",.properties)
        If $$$ISERR(sc) Quit sc
        If ($Get(properties("DispatchClass"))'="Harbor.Rest")!($ZConvert($Get(properties("NameSpace")),"U")'=targetNamespace) Quit $$$ERROR($$$GeneralError,"The /api/harbor route belongs to another application.")
    }
    Quit $$$OK
}
}
