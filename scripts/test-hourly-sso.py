"""PoC: temporary 20-second A/B tokens, real expiry, simulated hourly browser tick; restore settings."""
import json,os,subprocess,urllib.request,urllib.parse,uuid
from pathlib import Path
from test_helpers import Browser,token,user_id,local
base='http://localhost:8080';body=urllib.parse.urlencode(dict(client_id='admin-cli',grant_type='password',username='admin',password='admin-local-demo')).encode()
bearer=json.load(urllib.request.urlopen(urllib.request.Request(base+'/realms/master/protocol/openid-connect/token',data=body)))['access_token']
def api(path,method='GET',data=None):
 req=urllib.request.Request(base+'/admin/realms/sso-lab'+path,method=method,headers={'Authorization':'Bearer '+bearer,'Content-Type':'application/json'},data=json.dumps(data).encode() if data is not None else None)
 with urllib.request.urlopen(req) as r:
  raw=r.read();return json.loads(raw) if raw else None
saved=[];uid=None;a=Browser();name='hourly'+uuid.uuid4().hex[:8];email=name+'@example.test'
try:
 a.control_login('admin','admin-c');_,_,html=a.request('http://localhost:4003/users');assert a.request('http://localhost:4003/users',dict(csrf=token(html),username=name,email=email,password='ui-login-pass',allow_a='on',allow_b='on'))[0]==302
 _,_,html=a.request('http://localhost:4003/users');uid=user_id(html,email)
 for service in ['app-a','app-b']:
  local(service,email,True)
  c=api('/clients?clientId='+service)[0];saved.append(c);changed=dict(c);changed['attributes']={**c.get('attributes',{}),'access.token.lifespan':'20'};api('/clients/'+c['id'],'PUT',changed)
 subprocess.run(['node',str(Path(__file__).with_suffix('.cjs'))],env=dict(os.environ,FLOW_TEST_USER=name),check=True)
finally:
 for c in saved:
  current=api('/clients/'+c['id']);current['attributes']={**current.get('attributes',{}),'access.token.lifespan':c.get('attributes',{}).get('access.token.lifespan') or ''};api('/clients/'+c['id'],'PUT',current)
  assert (api('/clients/'+c['id']).get('attributes',{}).get('access.token.lifespan') or None)==(c.get('attributes',{}).get('access.token.lifespan') or None)
 for service in ['app-a','app-b']:local(service,email,False)
 if uid:
  _,_,html=a.request('http://localhost:4003/users');assert a.request('http://localhost:4003/users/'+uid+'/delete',dict(csrf=token(html)))[0]==302
 print('RESTORED original A/B token settings; removed PoC accounts',flush=True)
