const SALT = "cyxclub_salt_2026";
let ORIGIN = "https://cyxclub.top";

async function hashPwd(p) {
  const h = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(p + SALT));
  return Array.from(new Uint8Array(h)).map(b => b.toString(16).padStart(2,"0")).join("");
}
function genToken() { return Array.from(crypto.getRandomValues(new Uint8Array(32))).map(b=>b.toString(16).padStart(2,"0")).join(""); }
function now() { return Math.floor(Date.now()/1000); }
function genId(p) { const c="abcdefghijklmnopqrstuvwxyz0123456789"; let s=""; for(let i=0;i<6;i++) s+=c[Math.floor(Math.random()*36)]; return p+"_"+s; }
function genOrderVC(ds,seq){let h=0;const s=ds+seq+"cyx_order_2026";for(let i=0;i<s.length;i++)h=((h<<5)-h+s.charCodeAt(i))|0;const cs="ABCDEFGHJKLMNPQRSTUVWXYZ23456789";let r="";h=Math.abs(h);for(let i=0;i<4;i++){r+=cs[h%cs.length];h=Math.floor(h/cs.length);}return r;}

async function createSession(kv,uid,user,role){
  const t=genToken(),exp=now()+604800;
  await kv.put(t,JSON.stringify({user_id:uid,username:user,role:role,expires_at:exp}),{expirationTtl:604800});
  return t;
}
async function getSession(kv,t){if(!t)return null;const r=await kv.get(t);if(!r)return null;try{const d=JSON.parse(r);if(d.expires_at<now()){await kv.delete(t);return null;}return d;}catch{return null;}}
function getToken(r){const auth=r.headers.get("Authorization");if(auth&&auth.startsWith("Bearer "))return auth.slice(7);const c=r.headers.get("Cookie");if(!c)return null;for(const x of c.split(";")){const[i,...v]=x.trim().split("=");if(i==="cyx_session")return v.join("=");}return null;}
function setCookie(t){return "cyx_session="+t+"; Path=/; Max-Age=604800; HttpOnly; SameSite=None; Secure";}
function clearCookie(){return "cyx_session=; Path=/; Max-Age=0; HttpOnly; SameSite=None; Secure";}
function j(d,s){return new Response(JSON.stringify(d),{status:s||200,headers:{"Content-Type":"application/json","Access-Control-Allow-Origin":ORIGIN,"Access-Control-Allow-Credentials":"true"}});}
function ok(d){return j({success:true,data:d});}
function err(m,s){return j({success:false,error:m},s||400);}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;
    const db = env.cyxclub_db;
    const kv = env.SESSIONS;
    const reqOrigin = request.headers.get("Origin") || "";
    ORIGIN = ["https://cyxclub.top","https://admin.cyxclub.top","https://cyxclub.pages.dev","http://localhost:5173","http://localhost:3000"].includes(reqOrigin) ? reqOrigin : "https://cyxclub.top";

    if (method === "OPTIONS") {
      const o=request.headers.get("Origin")||"";
      const allowed=["https://cyxclub.top","https://admin.cyxclub.top","https://cyxclub.pages.dev","http://localhost:5173","http://localhost:3000"];
      return new Response(null,{status:204,headers:{"Access-Control-Allow-Origin":allowed.includes(o)?o:"https://cyxclub.top","Access-Control-Allow-Methods":"GET,POST,PUT,DELETE,OPTIONS","Access-Control-Allow-Headers":"Content-Type,Authorization","Access-Control-Allow-Credentials":"true","Access-Control-Max-Age":"86400"}});
    }
    if (path === "/" || path === "") return j({service:"CYX Club API",status:"running"});

    // DEBUG: check what auth info comes in
    if (path==="/api/debug/auth" && method==="GET") {
      const authHeader=request.headers.get("Authorization")||"none";
      const cookieHeader=request.headers.get("Cookie")||"none";
      const token=getToken(request);
      let session=null;
      if(token) session=await getSession(kv,token);
      return ok({hasAuthHeader:authHeader!=="none",authPreview:authHeader.slice(0,30),hasCookie:cookieHeader!=="none",tokenPreview:token?token.slice(0,16):null,session:session});
    }

    try {
      // PUBLIC
      if (path==="/api/announcements" && method==="GET") {
        const r=await db.prepare("SELECT * FROM announcements WHERE is_active=1 ORDER BY is_pinned DESC, created_at DESC LIMIT 20").all();
        return ok(r.results);
      }
      if (path==="/api/counter" && method==="GET") {
        const ip=request.headers.get("cf-connecting-ip")||"unknown";
        const t=Date.now();
        const row=await db.prepare("SELECT * FROM counter WHERE id=1").first();
        let sessions={},count=0;
        if(row){try{sessions=JSON.parse(row.sessions||"{}");}catch{}count=row.count||0;}
        const active={};
        for(const[k,ts] of Object.entries(sessions))if(t-ts<120000)active[k]=ts;
        if(!active[ip])count++;
        active[ip]=t;
        const ns=JSON.stringify(active);
        if(row)await db.prepare("UPDATE counter SET count=?,sessions=? WHERE id=1").bind(count,ns).run();
        else await db.prepare("INSERT INTO counter(id,count,sessions) VALUES(1,?,?)").bind(count,ns).run();
        return ok({total:count,online:Object.keys(active).length});
      }
      if (path==="/api/auth/login" && method==="POST") {
        const body=await request.json();
        const{username,password,role}=body;
        if(!username||!password)return err("missing credentials");
        const admin=await db.prepare("SELECT * FROM admins WHERE username=?").bind(username).first();
        if(admin){const h=await hashPwd(password);if(h!==admin.password_hash)return err("wrong password, got:"+h.slice(0,10)+", want:"+admin.password_hash.slice(0,10),401);
        try{const t=await createSession(kv,admin.id,admin.username,"admin");const r=ok({user:{id:admin.id,username:admin.username,role:"admin"},token:t});r.headers.set("Set-Cookie",setCookie(t));return r;}catch(e){return err("session error: "+e.message,500);}}
        if(role==="employee"){const w=await db.prepare("SELECT * FROM workers WHERE name=? AND status='active'").bind(username).first();if(!w)return err("not found",401);const h=await hashPwd(password);if(h!==w.password_hash)return err("wrong password",401);const t=await createSession(kv,w.id,w.name,"employee");const r=ok({user:{id:w.id,username:w.name,role:"employee"},token:t});r.headers.set("Set-Cookie",setCookie(t));return r;}
        const order=await db.prepare("SELECT * FROM orders WHERE order_no=?").bind(username).first();
        if(!order)return err("not found",401);if(!order.user_password)return err("no password",401);
        const h=await hashPwd(password);if(h!==order.user_password)return err("wrong password",401);
        const t=await createSession(kv,order.id,order.order_no,"user");
        const r=ok({user:{id:order.id,order_no:order.order_no,game:order.game,status:order.status,role:"user"},token:t});
        r.headers.set("Set-Cookie",setCookie(t));return r;
      }

      // PUBLIC products
      if(path==="/api/products"&&method==="GET"){return ok((await db.prepare("SELECT * FROM products ORDER BY id").all()).results);}

      // AUTH (needs session)
      if(path==="/api/auth/logout"&&method==="POST"){const t=getToken(request);if(t)await kv.delete(t);const r=ok({message:"logged out"});r.headers.set("Set-Cookie",clearCookie());return r;}
      if(path==="/api/auth/me"&&method==="GET"){const t=getToken(request);if(!t)return err("not logged in",401);const s=await getSession(kv,t);if(!s)return err("session expired",401);return ok({userId:s.user_id,username:s.username,role:s.role});}

      const token=getToken(request);if(!token)return err("not logged in",401);
      const session=await getSession(kv,token);if(!session)return err("session expired",401);

      // ADMIN
      if(path.startsWith("/api/admin/")){
        if(session.role!=="admin")return err("permission denied",403);
        const ap=path.replace("/api/admin","");

        if(ap==="/stats"&&method==="GET"){
          const o=await db.prepare("SELECT COUNT(*) as c FROM orders").first();
          const op=await db.prepare("SELECT COUNT(*) as c FROM orders WHERE status='pending'").first();
          const oc=await db.prepare("SELECT COUNT(*) as c FROM orders WHERE status='completed'").first();
          const w=await db.prepare("SELECT COUNT(*) as c FROM workers WHERE status='active'").first();
          const ctr=await db.prepare("SELECT count FROM counter WHERE id=1").first();
          return ok({orders:{total:o?.c||0,pending:op?.c||0,completed:oc?.c||0},workers:w?.c||0,visits:ctr?.c||0});
        }

        if(ap==="/announcements"&&method==="GET"){return ok((await db.prepare("SELECT * FROM announcements ORDER BY is_pinned DESC, created_at DESC").all()).results);}
        if(ap==="/announcements"&&method==="POST"){const b=await request.json();if(!b.title||!b.content)return err("title and content required");const id=genId("ann");await db.prepare("INSERT INTO announcements(id,title,content,category,is_pinned,is_active,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)").bind(id,b.title,b.content,b.category||"announce",b.is_pinned?1:0,1,now(),now()).run();return ok({id});}
        let m;
        if((m=ap.match(/^\/announcements\/([a-z0-9_]+)$/))){const id=m[1];if(method==="PUT"){const b=await request.json();await db.prepare("UPDATE announcements SET title=COALESCE(?,title),content=COALESCE(?,content),is_pinned=COALESCE(?,is_pinned),is_active=COALESCE(?,is_active),updated_at=? WHERE id=?").bind(b.title,b.content,b.is_pinned!==undefined?(b.is_pinned?1:0):null,b.is_active!==undefined?(b.is_active?1:0):null,now(),id).run();return ok({id});}if(method==="DELETE"){await db.prepare("DELETE FROM announcements WHERE id=?").bind(id).run();return ok({});}}

        if(ap==="/workers"&&method==="GET"){return ok((await db.prepare("SELECT id,name,games,status,created_at FROM workers ORDER BY created_at DESC").all()).results);}
        if(ap==="/workers"&&method==="POST"){const b=await request.json();if(!b.name||!b.password)return err("name and password required");const id=genId("w");await db.prepare("INSERT INTO workers(id,name,password_hash,games,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?)").bind(id,b.name,await hashPwd(b.password),b.games?JSON.stringify(b.games):"[]","active",now(),now()).run();return ok({id,name:b.name});}
        if((m=ap.match(/^\/workers\/([a-z0-9_]+)$/))){const id=m[1];if(method==="PUT"){const b=await request.json();if(b.password){await db.prepare("UPDATE workers SET password_hash=?,name=COALESCE(?,name),status=COALESCE(?,status),updated_at=? WHERE id=?").bind(await hashPwd(b.password),b.name,b.status,now(),id).run();}else{await db.prepare("UPDATE workers SET name=COALESCE(?,name),status=COALESCE(?,status),updated_at=? WHERE id=?").bind(b.name,b.status,now(),id).run();}return ok({id});}if(method==="DELETE"){await db.prepare("DELETE FROM workers WHERE id=?").bind(id).run();return ok({});}}

        if(ap==="/orders"&&method==="GET"){return ok((await db.prepare("SELECT o.*,w.name as worker_name FROM orders o LEFT JOIN workers w ON o.worker_id=w.id ORDER BY o.created_at DESC").all()).results);}
        if(ap==="/orders"&&method==="POST"){const b=await request.json();if(!b.game||!b.password)return err("game and password required");const d=new Date();const mm=String(d.getMonth()+1).padStart(2,"0");const dd=String(d.getDate()).padStart(2,"0");const dk=""+d.getFullYear()+mm+dd;const ds=mm+dd;const pc=(b.product_code||"GEN").toUpperCase().replace(/[^A-Z0-9]/g,"").slice(0,3).padEnd(3,"X");await db.prepare("INSERT OR IGNORE INTO order_counter(date_key,counter) VALUES(?,0)").bind(dk).run();const ctr=await db.prepare("UPDATE order_counter SET counter=counter+1 WHERE date_key=? RETURNING counter").bind(dk).first();const seq=ctr?ctr.counter:1;const vc=genOrderVC(ds,seq);const uid=b.user_id||0;const uidStr=String(uid).padStart(3,"0");const orderNo="CYX"+ds+pc+"-"+uidStr+"-"+vc+String(seq).padStart(2,"0");const id=genId("o");await db.prepare("INSERT INTO orders(id,order_no,user_id,worker_id,status,game,service_type,price,user_password,user_note,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)").bind(id,orderNo,uid,b.worker_id||null,"pending",b.game,parseInt(b.service_type)||1,parseInt(b.price)||0,await hashPwd(b.password),b.user_note||null,now(),now()).run();return ok({order_no:orderNo,password:b.password,id});}
        if((m=ap.match(/^\/orders\/([a-z0-9_]+)$/))){const id=m[1];if(method==="PUT"){const b=await request.json();await db.prepare("UPDATE orders SET status=COALESCE(?,status),worker_id=COALESCE(?,worker_id),updated_at=? WHERE id=?").bind(b.status,b.worker_id,now(),id).run();return ok({id});}if(method==="DELETE"){await db.prepare("DELETE FROM orders WHERE id=?").bind(id).run();return ok({});}}

        if(ap==="/products"&&method==="GET"){return ok((await db.prepare("SELECT * FROM products ORDER BY id").all()).results);}

        // Users
        if(ap==="/users"&&method==="GET"){return ok((await db.prepare("SELECT id,username,created_at FROM users ORDER BY id DESC").all()).results);}
        if(ap==="/users"&&method==="POST"){const b=await request.json();if(!b.username||!b.password)return err("username and password required");const ex=await db.prepare("SELECT id FROM users WHERE username=?").bind(b.username).first();if(ex)return err("username taken");const h=await hashPwd(b.password);await db.prepare("INSERT INTO users(username,password_hash,created_at) VALUES(?,?,?)").bind(b.username,h,now()).run();const u=await db.prepare("SELECT id FROM users WHERE username=?").bind(b.username).first();return ok({id:u.id,username:b.username});}
        if((m=ap.match(/^\/users\/(\d+)$/))){const uid=parseInt(m[1]);if(method==="DELETE"){await db.prepare("DELETE FROM users WHERE id=?").bind(uid).run();return ok({});}}

        return err("not found",404);
      }

      // USER
      if(path==="/api/workers"&&method==="GET"){return ok((await db.prepare("SELECT id,name,games FROM workers WHERE status='active'").all()).results);}
      if(path==="/api/orders"){
        if(session.role!=="user")return err("user only",403);
        if(method==="GET"){const o=await db.prepare("SELECT o.*,w.name as worker_name FROM orders o LEFT JOIN workers w ON o.worker_id=w.id WHERE o.id=?").bind(session.user_id).first();return ok(o?[o]:[]);}
        if(method==="POST"){const b=await request.json();if(!b.worker_id)return err("select a worker");const w=await db.prepare("SELECT id FROM workers WHERE id=? AND status='active'").bind(b.worker_id).first();if(!w)return err("worker not found");await db.prepare("UPDATE orders SET worker_id=?,updated_at=? WHERE id=?").bind(b.worker_id,now(),session.user_id).run();return ok({message:"selected"});}
      }

      // EMPLOYEE
      if(path.startsWith("/api/employee/")){
        if(session.role!=="employee"&&session.role!=="admin")return err("permission denied",403);
        const ep=path.replace("/api/employee","");
        if(ep==="/orders"&&method==="GET"){
          if(session.role==="admin")return ok((await db.prepare("SELECT o.*,w.name as worker_name FROM orders o LEFT JOIN workers w ON o.worker_id=w.id ORDER BY o.created_at DESC").all()).results);
          return ok((await db.prepare("SELECT o.*,w.name as worker_name FROM orders o LEFT JOIN workers w ON o.worker_id=w.id WHERE o.worker_id=? ORDER BY o.created_at DESC").bind(session.user_id).all()).results);
        }
        const sm=ep.match(/^\/orders\/([a-z0-9_]+)\/status$/);
        if(sm&&method==="PUT"){const oid=sm[1];const b=await request.json();const valid=["pending","in_progress","completed","cancelled"];if(!b.status||!valid.includes(b.status))return err("invalid status");let order;if(session.role==="admin")order=await db.prepare("SELECT id FROM orders WHERE id=?").bind(oid).first();else order=await db.prepare("SELECT id FROM orders WHERE id=? AND worker_id=?").bind(oid,session.user_id).first();if(!order)return err("not found",404);await db.prepare("UPDATE orders SET status=?,updated_at=? WHERE id=?").bind(b.status,now(),oid).run();return ok({message:"updated"});}
        return err("not found",404);
      }

      return err("not found",404);
    } catch(e) {
      return err("server error: "+e.message,500);
    }
  }
};
