  else err(`INSERT failed (${insertStatus}): ${JSON.stringify(insertData)}`);




  // T3: SELECT confirms presence
  const { data: selectData } = await rpc(`voice_calls?call_sid=eq.${TEST_SID}&select=call_sid,status`);
  if (Array.isArray(selectData) && selectData[0]?.call_sid === TEST_SID) ok('SELECT confirms inserted row');
  else err('SELECT did not find inserted row');




  // T4: UPSERT updates status (idempotent)
  const { status: upsertStatus } = await rpc('voice_calls', 'POST', {
    call_sid:        TEST_SID,
    status:          'completed',
    duration_seconds: 42,
    ended_at:        new Date().toISOString(),
  });
  // Supabase upsert via POST with Prefer: resolution=merge-duplicates
  const upsertHeaders = {
    apikey: SUPA_KEY,
    Authorization: `Bearer ${SUPA_KEY}`,
    'Content-Type': 'application/json',
    Prefer: 'return=representation,resolution=merge-duplicates',
  };
  const upsertResp = await fetch(`${SUPA_URL}/rest/v1/voice_calls?on_conflict=call_sid`, {
    method: 'POST',
    headers: upsertHeaders,
    body: JSON.stringify({
      call_sid: TEST_SID,
      status: 'completed',
      duration_seconds: 42,
      ended_at: new Date().toISOString(),
    }),
  });
  if (upsertResp.status === 200 || upsertResp.status === 201) ok('UPSERT updates existing row (idempotent)');
  else err(`UPSERT failed (${upsertResp.status})`);




  // T5: Verify status updated
  const { data: updData } = await rpc(`voice_calls?call_sid=eq.${TEST_SID}&select=status,duration_seconds`);
  if (updData?.[0]?.status === 'completed' && updData?.[0]?.duration_seconds === 42) ok('Status + duration updated correctly');
  else err(`Status update verification failed: ${JSON.stringify(updData?.[0])}`);




  // T6: Duplicate INSERT is tolerant
  const { status: dupStatus } = await fetch(`${SUPA_URL}/rest/v1/voice_calls?on_conflict=call_sid`, {
    method: 'POST',
    headers: { ...upsertHeaders, Prefer: 'return=minimal,resolution=ignore-duplicates' },
    body: JSON.stringify({ call_sid: TEST_SID, status: 'initiated' }),
  }).then(r => ({ status: r.status }));
  if (dupStatus === 200 || dupStatus === 201 || dupStatus === 204) ok('Duplicate INSERT tolerated (ignoreDuplicates)');
  else err(`Duplicate INSERT not handled gracefully (${dupStatus})`);




  // Cleanup
  const { status: delStatus } = await rpc(`voice_calls?call_sid=eq.${TEST_SID}`, 'DELETE');
  if (delStatus === 200 || delStatus === 204) ok('Cleanup DELETE');
  else err(`Cleanup DELETE failed (${delStatus})`);




  console.log(`\n📊 Results: ${pass} passed, ${fail} failed`);
  if (fail > 0) process.exit(1);
  console.log('✅ Voice persistence: ALL PASSED');
}




main().catch(e => { console.error('Fatal:', e.message); process.exit(1); });



