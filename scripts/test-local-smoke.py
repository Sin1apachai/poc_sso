"""Local authentication smoke test; no Keycloak settings or accounts are changed."""
from test_helpers import Browser, token
for port,password in [(4001,'admin-a'),(4002,'admin-b')]:
    browser=Browser()
    status,_,body=browser.request(f'http://localhost:{port}/login/local')
    assert status==302
    status,_,body=browser.request(f'http://localhost:{port}/login')
    assert status==200
    csrf=token(body)
    assert browser.request(f'http://localhost:{port}/login',dict(csrf=csrf,email='admin',password='wrong'))[0]==401
    status,headers,_=browser.request(f'http://localhost:{port}/login',dict(csrf=csrf,email='admin',password=password))
    assert status==302
    status,_,body=browser.request(f'http://localhost:{port}/')
    assert status==200 and 'LOCAL LOGIN' in body
    assert browser.request(f'http://localhost:{port}/logout',dict(csrf=token(body)))[0]==302
    assert browser.request(f'http://localhost:{port}/')[0]==302
    print(f'PASS local Login, wrong password and Logout: {port}',flush=True)
c=Browser();c.control_login('admin','admin-c')
assert c.request('http://localhost:4003/users')[0]==200
_,_,body=c.request('http://localhost:4003/')
assert c.request('http://localhost:4003/logout',dict(csrf=token(body)))[0]==302
assert c.request('http://localhost:4003/')[0]==302
print('PASS C Login, user management and Logout; no Keycloak configuration changed',flush=True)
