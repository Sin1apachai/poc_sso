import subprocess,os,uuid
from test_helpers import Browser,token,user_id,local
from pathlib import Path
a=Browser();a.control_login('admin','admin-c');name='ui'+uuid.uuid4().hex[:8];email=name+'@example.test'
_,_,body=a.request('http://localhost:4003/users');assert a.request('http://localhost:4003/users',dict(csrf=token(body),username=name,email=email,password='ui-login-pass',allow_a='on',allow_b='on'))[0]==302
_,_,body=a.request('http://localhost:4003/users');uid=user_id(body,email)
try:
 for service in ['app-a','app-b']:local(service,email,True)
 env=dict(os.environ,FLOW_TEST_USER=name);subprocess.run(['node',str(Path(__file__).with_name('test-api-mode.cjs'))],env=env,check=True)
finally:
 for service in ['app-a','app-b']:local(service,email,False)
 _,_,body=a.request('http://localhost:4003/users');assert a.request('http://localhost:4003/users/'+uid+'/delete',dict(csrf=token(body)))[0]==302
