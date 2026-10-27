export class RequestBodyError extends Error {}
/** Enforce the byte budget while streaming, even without Content-Length. */
export async function readBoundedJson(request:Request,limit=262144):Promise<Record<string,unknown>> {
  const reader=request.body?.getReader();if(!reader)throw new RequestBodyError("Request is empty.");
  const decoder=new TextDecoder();let size=0,text="";
  try{
    while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;
      if(size>limit){await reader.cancel();throw new RequestBodyError("Request is too large. Save fewer changes at once.");}
      text+=decoder.decode(value,{stream:true});}
    text+=decoder.decode();const value=JSON.parse(text);
    if(!value||typeof value!=="object"||Array.isArray(value))throw new Error();
    return value;
  }catch(error){if(error instanceof RequestBodyError)throw error;throw new RequestBodyError("Invalid request.");}
  finally{reader.releaseLock();}
}
