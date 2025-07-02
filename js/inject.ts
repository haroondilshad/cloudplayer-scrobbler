//////////////////////////////////////////////////////////////////////////////////////////////
// Copyright(C) 2010 Abdullah Ali, voodooattack@hotmail.com                                 //
//////////////////////////////////////////////////////////////////////////////////////////////
// Licensed under the MIT license: http://www.opensource.org/licenses/mit-license.php       //
//////////////////////////////////////////////////////////////////////////////////////////////

// Injects a script into the DOM, the new script gets executed in the original page's
// context instead of the active content-script context.

interface InjectResult {
    callResult: any;
    throwValue: boolean;
}

function injectScript(source: string | ((...args: any[]) => any), ...args: any[]): HTMLScriptElement | any {

    const isFunction = (arg: any): arg is Function => {
        return (Object.prototype.toString.call(arg) === "[object Function]");
    };

    const jsEscape = (str: string | undefined | null): string => {
        if (!str || !str.length) return str || "";
        const r = /['"<>\/]/g;
        let result = "";
        let l = 0;
        let c: RegExpExecArray | null;
        do {
            c = r.exec(str);
            result += (c ? (str.substring(l, r.lastIndex - 1) + "\\x" +
                c[0].charCodeAt(0).toString(16)) : (str.substring(l)));
        } while (c && ((l = r.lastIndex) > 0));
        return (result.length ? result : str);
    };

    const bFunction = isFunction(source);
    const elem = document.createElement("script");
    let script: string;
    let ret: InjectResult;
    let id = "";

    if (bFunction) {
        const funcArgs: string[] = [];

        for (let i = 0; i < args.length; i++) {
            const raw = args[i];
            let argStr: string;

            if (isFunction(raw)) {
                argStr = "eval(\"" + jsEscape("(" + raw.toString() + ")") + "\")";
            } else if (Object.prototype.toString.call(raw) === '[object Date]') {
                argStr = "(new Date(" + (raw as Date).getTime().toString() + "))";
            } else if (Object.prototype.toString.call(raw) === '[object RegExp]') {
                argStr = "(new RegExp(" + raw.toString() + "))";
            } else if (typeof raw === 'string' || typeof raw === 'object') {
                argStr = "JSON.parse(\"" + jsEscape(JSON.stringify(raw)) + "\")";
            } else {
                argStr = String(raw); // number/boolean/undefined/null
            }
            funcArgs.push(argStr);
        }

        while (id.length < 16) {
            id += String.fromCharCode(((!id.length || Math.random() > 0.5) ?
                0x61 + Math.floor(Math.random() * 0x19) : 0x30 + Math.floor(Math.random() * 0x9)));
        }

        script = "(function(){var value={callResult: null, throwValue: false};try{value.callResult=(("+
            source.toString()+")("+funcArgs.join()+"));}catch(e){value.throwValue=true;value.callResult=e;};"+
            "var scriptEl = document.getElementById('"+id+"'); if(scriptEl) scriptEl.innerText=JSON.stringify(value);})();";

        elem.id = id;
    } else {
        script = source as string; // source is a string here
    }

    elem.type = "text/javascript";
    elem.innerHTML = script;

    document.head.appendChild(elem);

    if (bFunction) {
        ret = JSON.parse(elem.innerText || "null"); // Provide fallback for innerText

        if (elem.parentNode) {
            elem.parentNode.removeChild(elem);
        }
        // delete (elem); // 'delete' has no effect on local variables

        if (ret.throwValue) {
            throw (ret.callResult);
        } else {
            return (ret.callResult);
        }
    } else {
        return (elem);
    }
}
