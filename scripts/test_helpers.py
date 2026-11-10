"""Fixture helpers for current Login tests; no test runs on import."""
import urllib.request,urllib.parse,urllib.error,http.cookiejar,re,subprocess
class NoRedirect(urllib.request.HTTPRedirectHandler):
 def redirect_request(self,*a,**k):return None
class LocalhostPolicy(http.cookiejar.DefaultCookiePolicy):
 def return_ok_secure(self,cookie,request):
  return urllib.parse.urlparse(request.full_url).hostname=='localhost' or super().return_ok_secure(cookie,request)
class Browser:
 def __init__(self):self.op=urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar(LocalhostPolicy())),NoRedirect())
 def request(self,url,data=None):
  assert urllib.parse.urlparse(url).hostname=='localhost'
  try:r=self.op.open(urllib.request.Request(url,data=urllib.parse.urlencode(data).encode() if data is not None else None),timeout=20)
  except urllib.error.HTTPError as e:r=e
  return r.status,r.headers,r.read().decode()
 def control_login(self,name,password):
  _,_,body=self.request('http://localhost:4003/login')
  status,_,_=self.request('http://localhost:4003/login',dict(csrf=token(body),login=name,password=password))
  assert status==302
  assert self.request('http://localhost:4003/')[0]==200
def token(body):return re.search(r'name="csrf" value="([^"]+)"',body).group(1)
def user_id(body,email):
 for row in re.findall(r'<tr>.*?</tr>',body,re.S):
  if email in row:return re.search(r'id="edit-(\d+)"',row).group(1)
 raise AssertionError('User not in management table')
def local(service,email,add):
 code="const {pool}=require('./src/db/database');(async()=>{try{if(process.argv[2]==='add'){const hash=await require('bcryptjs').hash('unused-local-password',12);await pool.query('INSERT INTO users(email,password_hash) VALUES($1,$2)',[process.argv[1],hash]);}else await pool.query('DELETE FROM users WHERE email=$1',[process.argv[1]]);}finally{await pool.end();}})().catch(()=>process.exitCode=1);"
 subprocess.run(['docker','compose','exec','-T',service,'node','-e',code,email,'add' if add else 'delete'],check=True)
