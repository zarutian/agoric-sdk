This service provides condition checking of conditions based off https://jsonlogic.org/

`interface Conditionor {
    onTrue: (condition:jsonlogicExtended, callback:Callback) => handle,
    onChange: (condition:jsonlogicExtended, callback:Callback) => handle
}
interface Callback {
    do: (result:boolean) => undefined
}
interface handle {
    cancel: () => undefined
}
`
