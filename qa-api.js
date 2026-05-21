import fetch from 'node-fetch';

async function run() {
  let score = 0;
  const baseURL = 'http://localhost:3001';
  let cookie = '';
  
  try {
    console.log('[Test 1] Unauthorized access to tasks...');
    const res1 = await fetch(`${baseURL}/api/notebooks/fake-id/tasks`);
    if (res1.status === 401 || res1.status === 403) {
      console.log('✅ Passed: Blocked unauthorized access');
      score += 20;
    } else throw new Error(`Expected 401/403, got ${res1.status}`);

    console.log('[Test 2] Signup local user...');
    const res2 = await fetch(`${baseURL}/api/auth/signup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ displayName: 'qatest' + Date.now(), passphrase: 'password123' })
    });
    const res2Body = await res2.text();
    console.log(`Status: ${res2.status}, Body: ${res2Body}`);
    const setCookieStr = res2.headers.raw()['set-cookie'];
    if (setCookieStr && setCookieStr.length > 0) {
      cookie = setCookieStr[0].split(';')[0];
      console.log('✅ Passed: Authenticated local user');
      score += 20;
    } else throw new Error('No cookie returned on signup');

    console.log('[Test 3] Create Notebook...');
    const res3 = await fetch(`${baseURL}/api/notebooks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Cookie': cookie },
      body: JSON.stringify({ title: 'QA Test Notebook', description: 'Testing' })
    });
    const nbData = await res3.json();
    console.log(`Notebook response:`, nbData);
    const nbId = nbData.id || nbData.notebook?.id;
    if (nbId) {
      console.log('✅ Passed: Created Notebook ' + nbId);
      score += 20;
    } else throw new Error('Failed to create notebook');

    console.log('[Test 4] Authorized Task Creation...');
    const res4 = await fetch(`${baseURL}/api/notebooks/${nbId}/tasks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Cookie': cookie },
      body: JSON.stringify({ instruction: 'Test Task', priority: 'high' })
    });
    if (res4.status === 201) {
      console.log('✅ Passed: Task created via authorized endpoint');
      score += 20;
    } else throw new Error(`Task creation failed with ${res4.status}`);

    console.log('[Test 5] Unauthorized Cross-Tenant Access...');
    const fakeId = '123e4567-e89b-12d3-a456-426614174000';
    const res5 = await fetch(`${baseURL}/api/notebooks/${fakeId}/tasks`, {
      headers: { 'Cookie': cookie }
    });
    if (res5.status === 404 || res5.status === 401) {
      console.log('✅ Passed: Cross-tenant unauthorized access blocked');
      score += 20;
    } else throw new Error(`Expected 404/401, got ${res5.status}`);

    console.log(`\n[RESULT] QA Tests Passed. Health Score: ${score}%`);
  } catch (err) {
    console.error(`❌ Test failed: ${err.message}`);
    console.log(`\n[RESULT] Health Score: ${score}%`);
  }
}

run();
