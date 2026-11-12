import { createServer } from 'node:net';
import { once } from 'node:events';
// Local SMTP fixture only. Messages are captured in memory; nothing is delivered externally.
export async function startTestMail() {
  const messages = [], sockets = new Set();
  const fixture = { messages, reject: false };
  const server = createServer(socket => {
    sockets.add(socket); socket.on('close',()=>sockets.delete(socket));socket.on('error',()=>{});
    let buffer='',dataMode=false,recipient='';
    socket.setEncoding('utf8');socket.write('220 localhost test SMTP\r\n');
    socket.on('data',chunk=>{
      buffer+=chunk;
      while(true){
        if(dataMode){const end=buffer.indexOf('\r\n.\r\n');if(end<0)return;messages.push({to:recipient,raw:buffer.slice(0,end)});buffer=buffer.slice(end+5);dataMode=false;socket.write('250 Message captured\r\n');continue;}
        const end=buffer.indexOf('\r\n');if(end<0)return;const line=buffer.slice(0,end);buffer=buffer.slice(end+2);
        if(/^(EHLO|HELO)/i.test(line))socket.write('250-localhost\r\n250 SIZE 100000\r\n');
        else if(/^RCPT TO:/i.test(line)){recipient=line.match(/<([^>]+)>/)?.[1]||'';socket.write(fixture.reject?'550 Recipient rejected\r\n':'250 OK\r\n');}
        else if(/^DATA$/i.test(line)){dataMode=true;socket.write('354 End with dot\r\n');}
        else if(/^QUIT$/i.test(line)){socket.end('221 Bye\r\n');return;}
        else socket.write('250 OK\r\n');
      }
    });
  });
  server.listen(0,'127.0.0.1');await once(server,'listening');
  fixture.env={ SMTP_HOST:'127.0.0.1',SMTP_PORT:String(server.address().port),SMTP_FROM:'FinSight <noreply@example.com>',SMTP_USER:'',SMTP_PASS:'' };
  fixture.close=async()=>{for(const socket of sockets)socket.destroy();await new Promise(resolve=>server.close(resolve));};
  return fixture;
}
export function emailCode(messages,email){
  const message=messages.filter(m=>m.to===email).at(-1);
  if(!message)throw new Error('No captured verification email for test account');
  const code=message.raw.replace(/=\r\n/g,'').replaceAll('=3D','=').match(/(?:^|\r?\n)(\d{6})(?:\r?\n|$)/)?.[1];
  if(!code)throw new Error('No email OTP in captured test email');
  return code;
}
export async function finishEmailVerification(client,email,request,messages){
  const result=await request(client,'/auth/verify-email','POST',{code:emailCode(messages,email)});
  if(result.status!==200)throw new Error('Test email verification failed: '+result.status);
}
