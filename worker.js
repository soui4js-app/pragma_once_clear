/* Worker code for unique_file_worker.js */
import * as std from "std";
import * as os from "os";
import * as utils from "utils.dll";

var parent = os.Worker.parent;
var bStop = false;

function matchFile(strFn, exts){
    let filename = strFn.toLowerCase();
    let bMatch = false;
    for(let j=0;j<exts.length && !bMatch;j++){
        if(exts[j]=="*"){
            bMatch = true;
        }else if(filename.endsWith("."+exts[j])){
            bMatch = true;
        }
    }
    return bMatch;
}

function enumFiles(folder,exts){
    let ret=[];
    let dirInfo = os.readdir(folder);
    if(dirInfo[1]!=0){
        console.log("enumDir dir "+folder+" get error:"+ dirInfo[1]);
        return ret;
    }
    let subDir = dirInfo[0];
    for(let i=0;i<subDir.length;i++){
        if(subDir[i] == "." || subDir[i]=="..")
            continue;
        let fullname = folder+"\\"+ subDir[i];
        let fstat = os.stat(fullname);
        if(fstat[0]==null){
            console.log("stat for " + fullname+" failed");
            continue;
        }            
        if(!(fstat[0].mode & os.S_IFDIR)){
            if(matchFile(fullname,exts))
                ret.push(fullname);
        }
    }
    return ret;
}

function rep_pragma_once(path){
    let ret = 0;
    let file = std.open(path,"rb");
    if(file!=null){
        file.seek(0,std.SEEK_END);
        let len = file.tell();
        file.seek(0,std.SEEK_SET);
        let buf = new ArrayBuffer(len);
        console.log("buf bytelength:",buf.byteLength);
        const u8Buf = new Uint8Array(buf);
        u8Buf[0]=0xff;

        let readed = file.read(buf,0,len);
        console.log("read bytes:",readed);
        let u8str="";
        if(u8Buf[0]==0xef && u8Buf[1]==0xbb && u8Buf[2]==0xbf){
            //utf8 bom
            console.log("this is a utf8 text file");
            u8str = utils.Buffer2String(u8Buf.subarray(3));
        }else if(u8Buf[0]==0xff && u8Buf[1]==0xfe){
            console.log("this is a utf16 text file");
            let u8Buf2 = utils.WString2String(u8Buf.subarray(2));
            u8str = utils.Buffer2String(u8Buf2);
        }else{
            let u16buf = utils.String2WString(u8Buf,utils.CP_ACP);
            let u8Buf2 = utils.WString2String(u16buf);
            u8str = utils.Buffer2String(u8Buf2);
        }
        file.close();
        if(u8str!=""){
            const pattern = /#pragma\s+once/;
            if(pattern.test(u8str)){
                let path2=path;
                path2=path2.replace("/","\\");
                let name = path2.split("\\").pop().split(".")[0];//get file name.
                name = name.toUpperCase();
                name = name.replace("-","_");
                let def = "__"+name+"__H__";
                let pos1 = u8str.search(pattern);
                let pos2 = u8str.search("#ifndef");
                let rep="";
                let addTail = false;
                if(pos2!=-1 && pos1!=-1 && pos2<pos1)
                {
                    rep = u8str.replace(pattern, "");
                }else{
                    rep = u8str.replace(pattern, "#ifndef "+def+"\n#define "+def);
                    addTail = true;
                }
                
                let fileOut = std.open(path,"wb");
                fileOut.putByte(0xef);
                fileOut.putByte(0xbb);
                fileOut.putByte(0xbf);

                fileOut.puts(rep);

                if(addTail)
                    fileOut.puts("\n#endif // "+def);
                fileOut.close();
                ret = 1;
            }
        }
    }
    return ret;
}

function handle_msg(e) {
    var ev = e.data;
    switch(ev.type) {
        case "abort":
            console.log("recv abort");
            bStop = true;
            break;
        case "start_scan":{
            parent.postMessage({ type: "enum files" });
            let files = [];
            for(var iDir = 0; iDir <ev.dirs.length && !bStop;iDir++){
                let path = ev.dirs[iDir];
                console.log(path);
                files=files.concat(enumFiles(path,["h"]));
                parent.poll();
            }
            parent.postMessage({ type: "scan_done",files:files });
            console.log("post msg done");
            parent.onmessage = null;
            break;
        }
        case "start_rep":{
            let files = ev.fileList;
            parent.postMessage({ type: "rep_range", total:files.length });
            for(let i = 0;i<files.length && !bStop;i++){
                let fileInfo = files[i];
                let ret = -1;
                if(fileInfo.chk_flag){
                    ret = rep_pragma_once(fileInfo.path);
                    parent.poll();
                }
                parent.postMessage({ type: "rep_prog", pos:i, status:ret });
            }
            parent.postMessage({ type: "rep_done" });
            console.log("post rep msg done");
            parent.onmessage = null;
        }
            break;
    }
}
parent.onmessage = handle_msg;
