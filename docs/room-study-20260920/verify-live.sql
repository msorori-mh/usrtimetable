SELECT jsonb_build_object(
 'versions',(SELECT jsonb_agg(v ORDER BY id) FROM public.schedule_versions v WHERE id IN ('c49a3694-3ade-5b2e-bbb2-6b5cafbbff50','f7348192-b851-4ac1-90aa-1b85d13dfc48')),
 'sessions',(SELECT jsonb_agg(s ORDER BY id) FROM public.schedule_sessions s WHERE schedule_version_id IN ('c49a3694-3ade-5b2e-bbb2-6b5cafbbff50','f7348192-b851-4ac1-90aa-1b85d13dfc48')),
 'rooms',(SELECT jsonb_agg(r ORDER BY id) FROM public.rooms r WHERE college_id='f30ff526-3918-4395-b8a0-dff1873534bf'),
 'source_hash',(SELECT md5(jsonb_agg(to_jsonb(s) ORDER BY id)::text) FROM public.schedule_sessions s WHERE schedule_version_id='c49a3694-3ade-5b2e-bbb2-6b5cafbbff50'),
 'target_hash',(SELECT md5(jsonb_agg(to_jsonb(s) ORDER BY id)::text) FROM public.schedule_sessions s WHERE schedule_version_id='f7348192-b851-4ac1-90aa-1b85d13dfc48'),
 'identity_differences',(SELECT count(*) FROM public.schedule_sessions s JOIN public.schedule_sessions d ON d.id=md5('f7348192-b851-4ac1-90aa-1b85d13dfc48'||s.id::text)::uuid WHERE s.schedule_version_id='c49a3694-3ade-5b2e-bbb2-6b5cafbbff50' AND (to_jsonb(s)-ARRAY['id','room_id','schedule_version_id','created_at','updated_at']) IS DISTINCT FROM (to_jsonb(d)-ARRAY['id','room_id','schedule_version_id','created_at','updated_at'])),
 'room_changes',(SELECT count(*) FROM public.schedule_sessions s JOIN public.schedule_sessions d ON d.id=md5('f7348192-b851-4ac1-90aa-1b85d13dfc48'||s.id::text)::uuid WHERE s.schedule_version_id='c49a3694-3ade-5b2e-bbb2-6b5cafbbff50' AND s.room_id IS DISTINCT FROM d.room_id),
 'source_target_map',(SELECT jsonb_agg(jsonb_build_object('source_id',s.id,'target_id',d.id,'source_room_id',s.room_id,'target_room_id',d.room_id)) FROM public.schedule_sessions s JOIN public.schedule_sessions d ON d.id=md5('f7348192-b851-4ac1-90aa-1b85d13dfc48'||s.id::text)::uuid WHERE s.schedule_version_id='c49a3694-3ade-5b2e-bbb2-6b5cafbbff50'),
 'events',(SELECT jsonb_agg(e ORDER BY created_at) FROM public.schedule_version_events e WHERE schedule_version_id='f7348192-b851-4ac1-90aa-1b85d13dfc48')
) AS verification;
