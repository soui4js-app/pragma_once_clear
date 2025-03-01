import * as soui4 from "soui4";
import * as os from "os";
import * as std from "std";
import * as utils from "utils.dll";

var g_workDir="";

class FileLvAdapter extends soui4.SLvAdapter{
	constructor(mainDlg){
		super();
		this.mainDlg = mainDlg;
		this.onGetView= this.getView;
		this.onGetCount = this.getCount;
		this.fileList = []; //prepare a file list. {path,chk_flag,status}
		this.dirtyCount = 0;
	}

	getView(pos,pItem,pTemplate){
		if(pItem.GetChildrenCount()==0){
			pItem.InitFromXml(pTemplate);
		}
		let wndName = pItem.FindIChildByName("txt_file");
		wndName.SetWindowText(this.fileList[pos].path);
		wndName.SetAttribute("tip",this.fileList[pos].path,false);
		let wndChkFlag = pItem.FindIChildByName("chk_flag");		
		wndChkFlag.SetCheck(this.fileList[pos].chk_flag);
		soui4.SConnect(wndChkFlag,soui4.EVT_CMD,this,this.onCheckClick);
		let imgStatus = pItem.FindIChildByName("img_status");
		let imgApi = soui4.QiIImageWnd(imgStatus);
		imgApi.SetIcon(this.fileList[pos].status);
		imgApi.Release();
		soui4.SConnect(pItem,soui4.EVT_ITEMPANEL_DBCLICK,this,this.onBtnExplore);
	}

	getItemIndex(pItem){
		let pItemPanel = soui4.QiIItemPanel(pItem);
		let iItem = pItemPanel.GetItemIndex();
		pItemPanel.Release();
		return iItem;
	}

	onBtnExplore(e){
		let btn=soui4.toIWindow(e.Sender());
		let pItem = btn.GetIRoot();
		let iItem= this.getItemIndex(pItem);
		console.log("do explore:",this.fileList[iItem].path);
		utils.SelectFile(this.fileList[iItem].path);
	}

	onCheckClick(e){
		let wndChkFlag=soui4.toIWindow(e.Sender());
		let checked = wndChkFlag.IsChecked();
		let pItem = wndChkFlag.GetIRoot();
		let iItem= this.getItemIndex(pItem);
		this.fileList[iItem].chk_flag = checked;
		console.log("onCheckClick:",iItem,"checked:",checked);
	}

	getCount(){
		return this.fileList.length;
	}
	
	setFiles(files){
		for(let i=0;i<files.length;i++){
			this.fileList.push({path:files[i],chk_flag:true,status:-1});
		}
		this.notifyDataSetChanged();
	}

	setFileStatus(iFile,status){
		this.fileList[iFile].status = status;
		this.dirtyCount ++;
		if(this.dirtyCount>10){
			this.update();
		}
	}

	update(){
		this.dirtyCount=0;
		this.notifyDataSetChanged();
	}

	clear(){
		this.fileList=[];
		this.notifyDataSetChanged();
	}

	getFileList(){
		return this.fileList;
	}
};

class MainDialog extends soui4.JsHostWnd{
	constructor(){
		super("layout:dlg_main");
		this.onEvt = this.onEvent;
		this.worker = null;
	}

	init(){
		this.EnableDragDrop();
		//enable dropdrop.
		this.edit_output=this.FindIChildByName("edit_output");
		this.prog_scan = this.FindIChildByName("prog_scan");
		
		this.lv_output = this.FindIChildByName("lv_output");
		let lvApi = soui4.QiIListView(this.lv_output);
		this.lv_adapter = new FileLvAdapter(this);
		lvApi.SetAdapter(this.lv_adapter);
		let adapterPtr = lvApi.GetAdapter();
		console.log("adapterPtr:"+adapterPtr);
		lvApi.Release();

		this.dropTarget = new soui4.SDropTarget();
		this.dropTarget.cbHandler = this;
		this.dropTarget.onDrop = this.onDrop;
		this.edit_output.RegisterDragDrop(this.dropTarget);

		soui4.SConnect(this.FindIChildByName("btn_run"),soui4.EVT_CMD,this,this.onBtnRun);
		soui4.SConnect(this.FindIChildByName("btn_stop"),soui4.EVT_CMD,this,this.onBtnStop);
		soui4.SConnect(this.FindIChildByName("btn_close"),soui4.EVT_CMD,this,this.onBtnClose);
		soui4.SConnect(this.FindIChildByName("btn_rep_sel"),soui4.EVT_CMD,this,this.onBtnRepSel);
		soui4.SConnect(this.FindIChildByName("btn_clear"),soui4.EVT_CMD,this,this.onBtnClear)
	}

	uninit(){
		let lvapi = soui4.QiIListView(this.lv_output);
		lvapi.SetAdapter(0);
		lvapi.Release();
		this.lv_adapter= null;

		this.edit_output.UnregisterDragDrop();
		this.dropTarget=null;
	}

	onEvent(e){
		if(e.GetID()==soui4.EVT_INIT){//event_init
			this.init();
		}
		return false;
	}
	
	onBtnClear(e){
		this.lv_adapter.clear();
	}

	onBtnRepSel(e){
		if(this.worker!=null)
		{
			console.log("worker is busy, please wait");
			return;
		}
		this.worker = new os.Worker("./worker.js");	
		this.worker.opaque = this;
		this.worker.onmessage = function (e) {
			var ev = e.data;
			switch(ev.type) {
				case "rep_range":
					{
						let progApi = soui4.QiIProgress(this.opaque.prog_scan);
						progApi.SetRange(0,ev.total);
						progApi.SetValue(0);
						progApi.Release();
						console.log("prog",ev.path);
					}
					break;
				case "rep_prog":
					{						
						let progApi = soui4.QiIProgress(this.opaque.prog_scan);
						progApi.SetValue(ev.pos+1);
						progApi.Release();					
						this.opaque.lv_adapter.setFileStatus(ev.pos,ev.status);
					}
					break;
			case "rep_done":
				/* terminate */
				let _this = this.opaque;
				this.onmessage = null;
				this.opaque = null;
				_this.worker = null;
				_this.lv_adapter.update();
				console.log("worker finished");
				break;
			}
		};
		this.worker.postMessage({type:"start_rep",fileList:this.lv_adapter.getFileList()});
	}

	onBtnClose(e){
		this.onEvt = 0;
		this.uninit();
		this.DestroyWindow();
	}

	onBtnStop(e){
		if(this.worker!=null)
		{
			console.log("stop worker");
			this.worker.postMessage({ type: "abort",data:100 });
		}	
	}

	onBtnRun(e){
		let buf = this.edit_output.GetWindowText(true);
		let dirs = buf.split("\r\n");
		
		this.worker = new os.Worker("./worker.js");	
		this.worker.opaque = this;
		this.worker.onmessage = function (e) {
			var ev = e.data;
			switch(ev.type) {
			case "scan_done":
				/* terminate */
				let _this = this.opaque;
				{
					_this.lv_adapter.setFiles(ev.files);
				}
				this.onmessage = null;
				this.opaque = null;
				_this.worker = null;
				console.log("worker finished");
				break;
			}
		};
		this.worker.postMessage({type:"start_scan",dirs:dirs});
	}

	onDrop(fileCount){
		let editApi = soui4.QiIRichEdit(this.edit_output);

		let enumDir = function(folder){
			soui4.log("enumDir dir:"+folder);
			let fstat = os.stat(folder);
			if(!(fstat[0].mode & os.S_IFDIR)){
				return;
			}
			editApi.SetSel(-1,-1,true);
			editApi.ReplaceSel(folder+"\n",false);
			let dirInfo = os.readdir(folder);
			if(dirInfo[1]!=0){
				soui4.log("enumDir dir "+folder+" get error:"+ dirInfo[1]);
				return;
			}
			soui4.log("enumDir dir list:"+dirInfo[0]);
			let subDir = dirInfo[0];
			for(let i=0;i<subDir.length;i++){
				if(subDir[i] == "." || subDir[i]=="..")
					continue;
				let fullname = folder+"/"+ subDir[i];
				let fstat = os.stat(fullname);
				if(fstat[0].mode & os.S_IFDIR){
					enumDir(fullname);
				}
			}
		}

		for(let i=0;i<fileCount;i++){
			let filename = new soui4.SStringA();
			this.dropTarget.GetDropFileName(i,filename);
			let fn = filename.c_str();
			enumDir(fn);
		}
		editApi.Release();
		this.edit_output.Update();
	}
};


function main(inst,workDir,args)
{
	JSON.stringify
	soui4.log(workDir);
	g_workDir = workDir;

	let theApp = soui4.GetApp();
	let souiFac = soui4.CreateSouiFactory();
	//*
	let resProvider = souiFac.CreateResProvider(1);
	soui4.InitFileResProvider(resProvider,workDir + "/uires");
	//*/
	/*
	// show how to load resource from a zip file
	let resProvider = soui4.CreateZipResProvider(theApp,workDir +"/uires.zip","souizip");
	if(resProvider === 0){
		soui4.log("load res from uires.zip failed");
		return -1;
	}
	//*/
	let resMgr = theApp.GetResProviderMgr();
	resMgr.AddResProvider(resProvider,"uidef:xml_init");
	resProvider.Release();
	let hwnd = soui4.GetActiveWindow();
	let hostWnd = new MainDialog();
	hostWnd.Create(hwnd,0,0,0,0);
	hostWnd.SendMessage(0x110,0,0);//send init dialog message.
	hostWnd.ShowWindow(1); //1==SW_SHOWNORMAL
	souiFac.Release();
	let ret= theApp.Run(hostWnd.GetHwnd());
	hostWnd=null;
	soui4.log("js quit");
	return ret;
}

globalThis.main=main;