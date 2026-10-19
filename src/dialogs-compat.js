// mtcute 0.32.2 requests messages.getPeerDialogs([]) for chatlist folders
// without pinned peers. Telegram rejects that otherwise valid folder read.
export function installDialogCompatibility(client){
  const original=client.iterDialogs.bind(client);
  client.iterDialogs=async function*(params){
    if(params?.limit!==undefined&&params.limit<=0)return;
    if(params?.folder&&(params.pinned===undefined||params.pinned==='include'||params.pinned==='only')){
      let folder=params.folder;
      if(typeof folder==='string'||typeof folder==='number'){
        const {filters}=await client.getFolders();
        folder=filters.find(f=>f.id===params.folder||f.title?.text===params.folder);
      }
      const effective=folder&&typeof folder==='object'?{...folder,...params.filter}:null;
      if(effective?._==='dialogFilterChatlist'&&effective.pinnedPeers.length===0){
        // Keep the original offset validation in the SDK.
        if(params.pinned==='only'&&!params.offsetId&&!params.offsetDate&&(!params.offsetPeer||params.offsetPeer._==='inputPeerEmpty'))return;
        params={...params,folder,pinned:params.pinned==='only'?'only':'keep'};
      }
    }
    yield* original(params);
  };
}
