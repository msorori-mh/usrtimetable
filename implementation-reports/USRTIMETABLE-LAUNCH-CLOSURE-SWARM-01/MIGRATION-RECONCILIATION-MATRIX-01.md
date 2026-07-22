# MIGRATION RECONCILIATION MATRIX 01 (TRACK 8)

**Repository:** msorori-mh/usrtimetable — **Path:** `supabase/migrations/`
**Source ref:** `main` @ `b6a5a491f9f70f1cfba5dc5696fb33f64dbcee6b` (directory listing verified byte-identical at current main HEAD `7d738204c7824e12668d017d4c3de4f0d0af1f55`)
**Generated:** 2026-07-22 by AGENT-MIGRATION-RECONCILIATION (swarm USRTIMETABLE-AUTONOMOUS-SOURCE-CLOSURE-WAVE-03)

> **SAFETY: REVIEW ONLY. NOTHING IN THIS DOCUMENT APPLIES, HAS APPLIED, OR WILL APPLY ANY MIGRATION.**
> No database was accessed. Every future apply step requires an explicit `APPROVE_DB_MIGRATION_APPLY` gate approval.

**Method:** File inventory, blob SHA1 and sizes come from the GitHub directory-listing API at the source ref (authoritative). SHA256 values were computed locally with `sha256sum` from fetched file contents and **byte-verified against the authoritative git blob SHA1** (`git hash-object`); rows whose content was not fetched or could not be byte-verified are honestly marked `NOT_COMPUTED`. 97 of 109 migrations have verified SHA256.

## 1. Full inventory — 109 migrations

| # | Filename | Version | Blob SHA (SHA1, git) | Size (bytes) | SHA256 (content) |
|---|----------|---------|----------------------|--------------|------------------|
| 1 | `20260604222655_952c4a6f-97a2-4452-ba21-63fddd66bbfb.sql` | 20260604222655 | `d14705c5a1e3a448c42bce9bf5c0e9c8ccd27958` | 3271 | `43a02d34e23ce2af4c8bc4f91418f880587007a33ab88b9f7fbeede83a381bf6` |
| 2 | `20260604222725_e869fc5e-74a1-4f37-9af5-bb6aa9946911.sql` | 20260604222725 | `cacc57d4477af039db297e89e0373c2656356b7a` | 5700 | `8e758d2144497d4e459973d045edb54f977aed4cc355f642b734b550c4fb` |
| 3 | `20260604222742_08587299-53ec-415a-ae2c-824917a1f61b.sql` | 20260604222742 | `03e7b682e1ae8b00a10e8316c6bc3a4656ae0c78` | 517 | `a786bb2ec3e692fdb4672367f0642cf50b0f1af9edca9ab3c20e93bb4e43c571` |
| 4 | `20260604225017_41baaa6b-647b-4c2f-bd10-32d352b9c8f6.sql` | 20260604225017 | `07846a9f01aff4e142abcef78afdf9d3af97d95c` | 16575 | `d8d7a226838447f60a956da305d23efb26cac4927d60b1dd4c4bf381db03c4df` |
| 5 | `20260604230713_94c6fd6a-b5aa-490d-8d86-9a8f7b199e4f.sql` | 20260604230713 | `5e8a601a72d4860a5de2decf7fdc3beea567ece8` | 14916 | `f4b90310d2348779d2f75a01afd2be62fa5dfba1d4a6f7b3f2878f75aec1e90f` |
| 6 | `20260604235253_296334b2-e453-4083-94b5-21362d41fd91.sql` | 20260604235253 | `35de1061c47073915fa7d02918875f09cd6583d1` | 18885 | `494a75b9e4597c95198754c48c930bdb1d41290479a0edc166edde93d8a72850` |
| 7 | `20260605000554_0c4cd895-4696-46f7-85cb-8cba800c40c2.sql` | 20260605000554 | `d420793273e58a08df34a6d37210ba737bd6138a` | 5299 | `af580fa77a3b0fb7479ba0403cc6d2e48ad13104f129a89d620ae690b2159248` |
| 8 | `20260605001512_5e0e8801-eb18-4186-b505-bfd47296db13.sql` | 20260605001512 | `3813a6ad1734534d507696783c591e63e5998e95` | 16294 | `4998386a0e77423e4c0c63c2c24ffa3c7c3b646be0f9de0bbc1e0fff7da8e572` |
| 9 | `20260605002216_5a3621d3-8358-427d-be91-9bb7f4103861.sql` | 20260605002216 | `7640f297a8024658ee61b879675a9667057bd4c3` | 3671 | `040e8b364bd38f0d99e6135ac4d5276b369f1b3bbc0b1874a569c3d7275822f3` |
| 10 | `20260605010648_d8cfad45-0236-4a88-ac1d-78bb28bb3326.sql` | 20260605010648 | `ae8c689afd0a1c47511da93284b0e351de5edbbe` | 498 | `40b986aacf4a3776d6376d379194b0ed9939cf3ef7b6fe2d14d1ac29047f233f` |
| 11 | `20260605011516_481f5339-b6b0-4d53-9b71-06a1e8adbba8.sql` | 20260605011516 | `e07d3c8c9804211af17f1a5332aad5c11b9dc3bf` | 2188 | `0a9fad8cf2dd3cc4b7024e80f5c9b5204d0b33e7f5742f091f79c2e53599f2ca` |
| 12 | `20260605012358_2eaafd07-a267-44bb-bcac-15dd69c07701.sql` | 20260605012358 | `38dc1652abb90671e128bc2900c9825afc507575` | 4747 | `325d5078c9ef557d670abb76ff46a7be3fa0195382b9756c150b0300f49a461f` |
| 13 | `20260605013524_3d61d3cc-2c94-4e85-a6bb-78ae3029023f.sql` | 20260605013524 | `6f8fa72bd8e1da04d758922d6f5ba1702e85fbf1` | 10182 | `842b92c205a8d035e7c6bdc121c282c007e2c4435145329431d8e703934cb168` |
| 14 | `20260605020637_c025bcf6-4f59-4405-9194-2436cc684baf.sql` | 20260605020637 | `2b6af6a5ad57b288fb9711deac530542026fb3ac` | 5946 | `d84cbd706db1e9fd3493a12ec0b1768cfeebf27e902cef83fe25c7b77515f7c4` |
| 15 | `20260605214903_cb0df2c6-e8a9-4099-be2f-6a6a02a25aa0.sql` | 20260605214903 | `e3f641e05512eb34e0328ebfca4d10bd3069d56d` | 2340 | `881755ea92eb567c59e1d5ae2a4d6e992b52b11d8a158514fbdc936904e9858f` |
| 16 | `20260606184852_a88e79bf-b065-4f18-b246-6d11c69756d6.sql` | 20260606184852 | `1241c332a4dbe79abacaa2b745d67770e6e8b3dd` | 3643 | `6ac6b7da30b8458a6c46e7338fb34c05ff40e0156142c4b9182d608ec1db7c67` |
| 17 | `20260606190549_275712f0-2e77-43e7-b80d-98b44a3b11e4.sql` | 20260606190549 | `94a5353c624d99a57eb5f538a184214b9d030099` | 2447 | `319fc7287f170c0333264cca9829f6d261218f4234b4ffe608c331e10da67f55` |
| 18 | `20260607002310_e8868a71-28c7-4aad-84e0-a35ef7e964f5.sql` | 20260607002310 | `090c2edc7ea93d059d543dbc5fa5b8a4bde74118` | 485 | `647ae35214deccaa5b8a48b25ea5d584c435eeba6da76990479420c2796e08b3` |
| 19 | `20260607002733_201f5428-aa62-4cd2-8bd1-1e4fc5567eb4.sql` | 20260607002733 | `1ed5a852ed68f3e549ca8454fc5a63b69b707919` | 313 | `e6162546fd9dee85cdb00cae816761ef676956350a4c007d3cbb83f0fb49292f` |
| 20 | `20260616041218_6b58bcca-e29f-4673-ab63-50aaff5fca04.sql` | 20260616041218 | `48d6ff35fd8bcdff80682d336d16b8167c1b34cd` | 402 | `0fcc6c69087c0a9cc6a5b2c83d12a68d6eff9cc8b66b75fef34002395ff23782` |
| 21 | `20260617232452_5b686a90-ab47-4512-89db-c311c7e9ff5b.sql` | 20260617232452 | `c085a43865d11a5a116c58f6478fa81d30a2ab17` | 165 | `9bea0ffd8885d93e814dfbd5eddcbdb838ab3637148fb1c48d3bcfadac93da71` |
| 22 | `20260630231919_f87d6db3-829d-4e6f-b868-76166820121e.sql` | 20260630231919 | `d75c3b3205b70106eb93f3f5de2a65c7d4b4ab8b` | 242 | `1b0bc8e761736115d36ec71443f19196c1f019643903fa764381a9979b98309d` |
| 23 | `20260630232652_fae422ed-938e-4834-ab43-c7bde356e99b.sql` | 20260630232652 | `d4275abee00460add097a46db02235f30df211ae` | 3489 | `ad3215109d7462e802381a3b9800588c34ac13a99da287d40b01c806d63d9c8b` |
| 24 | `20260701204416_a302ec06-fa90-46d2-a2f7-dd73bf651264.sql` | 20260701204416 | `35df843d58032cb3dfd01f6a160feed9775e099e` | 169 | `103e5931ea28171378ed5529ce2c93eb803ac7f84fbd21bcd70fb3b2b1e46a66` |
| 25 | `20260709193500_schedule_version_conflict_exceptions.sql` | 20260709193500 | `254450665b9489399572c1730d1d1a3f841c4804` | 5362 | `b0528f29cee6aeb4001772ecd613192f052a63971533c35287ea8ad259329d21` |
| 26 | `20260709213405_a7ddbff3-f65a-4b45-80d1-6f4e49ae0f1b.sql` | 20260709213405 | `15ca9944195af204f51a60f57c9f240bb71fa423` | 4781 | `f662153560c0b3b1f33cd502c46b13f8a5318c665ec0e468f4016e840d50382d` |
| 27 | `20260709213525_62114af2-d295-453e-a33d-978f3f5bf839.sql` | 20260709213525 | `ff102e88722da12e957ccbd52a89c7cf6171979e` | 76 | `058144d22154a6d5aa67476b3a05879b8fdfc7118eb761acdca0e5657729a7ab` |
| 28 | `20260709213902_a070c634-dad0-4ff8-b5af-548d1328d135.sql` | 20260709213902 | `4a9d4193c4d9e0a88ca788017dd0ed2a74bd27c3` | 42325 | `NOT_COMPUTED` |
| 29 | `20260709213954_0a0f7761-4ee5-43bd-b8e5-7074b2e42256.sql` | 20260709213954 | `3a21d4f98dc5370e8316aeee8c393d84a5770a68` | 3343 | `9da8b570c4d16d19122b73eb01d1d2f6c550a6a54a97a45028cfdc9775022f80` |
| 30 | `20260714010000_schedule_session_move_rpc.sql` | 20260714010000 | `6364b8b147b494dc801278674a3975c57ae79102` | 33807 | `NOT_COMPUTED` |
| 31 | `20260714012008_a6bb4288-ac48-4681-ad6e-634cf572e904.sql` | 20260714012008 | `5402eab7c0c2562673275a582cead75ca1bf91e1` | 33803 | `NOT_COMPUTED` |
| 32 | `20260715011643_a67fc9c2-5f77-4d33-a96b-12a63d8e3a71.sql` | 20260715011643 | `1e23d830fdf7f913cf36b031a7e68d4c2281a020` | 5731 | `92c4e20f94a863414d4e8917002aad512ceb060385010eea6e8d7b55b4aa9f5e` |
| 33 | `20260715012000_section_subgroups_capacity_model.sql` | 20260715012000 | `ece834dd7eb66597f968ae47671f6052fc03ca6f` | 5732 | `5ac0e71bea31d6f6ddcf9fbde113e7b736d1e85b001dbc149dd696d33a028438` |
| 34 | `20260715012100_ss_conflict_item.sql` | 20260715012100 | `bfe6dd2411de5e6a4bc0b3368770366f0951b387` | 504 | `a42d7d9341c56171501d648c1ac5566d5b23407777c3c209e17ec59811b50001` |
| 35 | `20260715012113_5dc4e309-049f-472f-b9e0-011948f4b8dd.sql` | 20260715012113 | `473a01e675664bf63c6b3f11abfb4daf2ba88fe1` | 249 | `848beff4bc2f37db2e282550160013be1055ccfc6de383b569e72b98343f76a9` |
| 36 | `20260715012200_ss_time_overlap.sql` | 20260715012200 | `8b141fd59cd87a8fd450129fe1ab9b55e326bd83` | 350 | `1b6f9435cf6b2ba74efc75c3d4549641c3db1eeb9275682e178d9266291f877f` |
| 37 | `20260715012228_a32a63af-8180-4ba0-a974-492a31b129a8.sql` | 20260715012228 | `3601e29a094fc0f9f43294ef3a7cd115f6cee652` | 46 | `24f432b481fe442eb65bf5edeea69a8a6260221772df760a3b9be33f219c678c` |
| 38 | `20260715012300_ss_session_subgroup.sql` | 20260715012300 | `d1c771a995d64c10e9d0de4bfd0844f4ff89f5cd` | 347 | `f073108dbb159a29a6152e03799e6b91641c24639739cd4f9aab7d42bfa3d6ca` |
| 39 | `20260715012400_ss_section_peer_hit.sql` | 20260715012400 | `8ff2719221f643eb0e1b988a6f3ccfea37e4786f` | 499 | `ee47451d3591c34b525c85e3850627c438a9ad9e71e3d504ba87abed6a5914a6` |
| 40 | `20260715012500_ss_enroll_trust.sql` | 20260715012500 | `54fd6214aa54adc4ad28111ec538a6bda3110dcd` | 592 | `4e3120d08df1983fa90bc9859165f18e12e5a5a90e67344645000f2dd325bd70` |
| 41 | `20260715012600_ss_capacity_item.sql` | 20260715012600 | `58137afd07bcd637512764ef6809d45ad29dad5a` | 793 | `062b09286c67ca0e64b07b209817ea82f00277b15bb4a821de3e779739c54c2d` |
| 42 | `20260715012700_ss_peer_instructor.sql` | 20260715012700 | `7c0120e9f347f9cde4448dc1c0db51a315c25015` | 1016 | `73a2743d9147fe39fd3a7da2e1a53385db31d36bd5924c3e404d8d5ea9436cf0` |
| 43 | `20260715012800_ss_peer_room.sql` | 20260715012800 | `883e7c30e315f1b92382ff628d1d06207e266d08` | 1034 | `f85235eee9c369a5e5a615e0e53afab3d20f68afb081206273452a4388010420` |
| 44 | `20260715012900_ss_peer_section.sql` | 20260715012900 | `edc4ab264e9f1930d9527d08c37eeb289a433bf3` | 1182 | `bb96071e1c9aa235f626f76b2cf2baf7dbb4a2b857dc99ebb10febcc0c931805` |
| 45 | `20260715013000_ss_room_college_cap.sql` | 20260715013000 | `8ff2c6f3b3081d4fac4d19902ed6006652c32839` | 1014 | `16945b791559fbfdbd070df8dcf2408ce8aa82fe55d76ceb1dee0edebd5d2809` |
| 46 | `20260715013100_ss_room_type.sql` | 20260715013100 | `cfa5b9964cc3df2ab729884b529f739b1c909669` | 939 | `94e76f9ebcc0b7a8a42a189ed49aa69a3396d5f8391a5edda58cbc1b868be55d` |
| 47 | `20260715013200_ss_room_availability.sql` | 20260715013200 | `cafc39a7f0265cebb693bf688ac3dbf482daf66d` | 1067 | `a5bd8e60f0c602289a729ea1d9e1cbc6d4a99ce2745ed3b8c29220f7b1f5ecba` |
| 48 | `20260715013300_ss_instr_avail_required.sql` | 20260715013300 | `c60e26f3a8bce0d51180c335a0753c1368a79385` | 1094 | `efdb7f6137b92f1fb94881ca828b117d6a4a8e85ef60653c7381278350fe1fe9` |
| 49 | `20260715013400_ss_instr_avail_window.sql` | 20260715013400 | `30a4dddbd7da13aebd0fb48e77ae9bf9c7497436` | 1519 | `c9a65338b1f52e0e5890106b3bdf4ee662152ecab98d72c44b200ffd225d7ecf` |
| 50 | `20260715013500_ss_template_conflicts.sql` | 20260715013500 | `7a5aa0bb82c225f724aa38b9480861b9aaa3f8ee` | 1188 | `7255da7e0f4da1998933cca6beb74fc62e0c8180e5d54533cc013c29c2753c4c` |
| 51 | `20260715013600_ss_settings_conflicts.sql` | 20260715013600 | `8f15bc319d654074318b923d724d7f9e83446458` | 1128 | `5a2cca85f550f12f59dfaae092385093130e5a76ea0a5128ab14b086e49fa666` |
| 52 | `20260715013700_ss_break_conflicts.sql` | 20260715013700 | `cf78163db47818d169852ba665b3602e12d719db` | 769 | `7d6c528c1615a9bb851631083b5aad86590933f29fa92e96626d0fd5b3b83f3f` |
| 53 | `20260715013800_ss_exception_match.sql` | 20260715013800 | `3ac3fa5a507d2c49fa7ecd50499e66cea207f364` | 1181 | `320a0ae249555deac95568cd922599ccde402462743e1efdade96fd66dea85d3` |
| 54 | `20260715013900_ss_pack_exceptions.sql` | 20260715013900 | `d5f5c19223e77cc7d75729b8aa222aa2ea4e8fce` | 1367 | `4d872fbfb81d50a6e33c547946f335a7a13780e6d5cc1e889e6803a63d64c23b` |
| 55 | `20260715014000_ss_gather_conflicts.sql` | 20260715014000 | `2de15569a1d111480bec4a75db7e0818ebd0d10f` | 1130 | `b9ea0a7b26385e28d6b979c8cdee0c32aa69c30b913ab615c0ff551c7d8301e7` |
| 56 | `20260715014100_ss_collect_replace.sql` | 20260715014100 | `0445379f9f1737956aef6fdb338bf1e2c0722ebd` | 1060 | `6dc6dd7b8dcbaad53ea2bca322413e8770aa8adce7c0812d4c4854c0a9c86a88` |
| 57 | `20260715024641_c6b3adb8-4070-4ef1-94a2-75c28dbfbf07.sql` | 20260715024641 | `7a62e129e5feb7916bfe737efe36b7a029dfd60d` | 503 | `254308601210be0a3c0f23dfeb5c4fc3438ff97af6eff1c992696d952f8ce614` |
| 58 | `20260715024703_78a013d7-3bdb-4f8c-ac7c-1f5fa6402c41.sql` | 20260715024703 | `f26bfea2dd8e9de97424a9551835ca6d2103eb26` | 349 | `150a4941ad55191f2b34b926e21ad16df31f117754c308eb2b298caa3cdd565d` |
| 59 | `20260715024719_f93a86a8-862d-4ba4-b177-50a346e46cb4.sql` | 20260715024719 | `5aec52bef70f86c2231e57c0d44f751c8d145336` | 346 | `37d4be0a924254aef813ba618fad50cd14d082f5123e68e7b65e733d878052a8` |
| 60 | `20260715024733_fd5b96e2-197e-43d3-8de1-6aaa54f91e5a.sql` | 20260715024733 | `3e6e3c7fb619d45d734eb7769e053fd3f2175e1a` | 498 | `82870c8d74dce1aa2c5eb4ae9a77b7df66997915adc66d0854f96a2b5246e96d` |
| 61 | `20260715024746_486a8d71-66db-4218-a556-3b7425f33f12.sql` | 20260715024746 | `117404cfb1c6774197a9136d80a8e8617d59f7ca` | 591 | `27a55688ebc98895a66fd436dcc7ff16113d788a56b71e9fb971da0906e70ef0` |
| 62 | `20260715024801_effef179-108b-4494-8689-c1ec7c2311dc.sql` | 20260715024801 | `c03e175e5ac831be531e7da3012effc61b6bdef4` | 792 | `184c8d0549f3da7123879482e5b99d437f6d5b6d535332be7a570aac190b524d` |
| 63 | `20260715024816_dc4d6640-36cf-417b-99f5-ce85e87eaa97.sql` | 20260715024816 | `bc1ebcaa2df0f402c6d74df072fd46029044ceee` | 1015 | `ee7be2abab346fcafe7a1e05e31f6bf49cb8d6f23cfabdfd5bbaf63a7a2c4dcb` |
| 64 | `20260715024832_23314574-c284-4edc-bd90-aeec91776e9b.sql` | 20260715024832 | `276d0d859751b97ff883ead6de37d5bb91e2ba5d` | 1033 | `1a828d4d01d86bbc42af405ef051427f575414d95a358b0a6e6531521689af96` |
| 65 | `20260715024848_ea741580-cfd9-413d-a0ac-056bb5f84e80.sql` | 20260715024848 | `0096aa546a2844cda9682f301045c13f26ceec04` | 1181 | `c38090e0b86d32ecd1193225c67bd3e853894fc765a0e30c796534bd3379df40` |
| 66 | `20260715024904_d3dc44a9-15f0-4f77-869b-6eb9d4fc0177.sql` | 20260715024904 | `4d97b2ee2ea8f21c8db1419a9d5238477ab9cd4b` | 1013 | `01d985011985fcf4787cbb60acfd5a1243be5769587997411180c698c57b4a4a` |
| 67 | `20260715024918_b86f07f4-4c6d-4119-9b1a-3bcad6cad3aa.sql` | 20260715024918 | `01ddf5d24a20e604688b332432c078c289a4a227` | 938 | `9c82ee7545b10b54a7dfa4d9f9c1427ccff52dcd368eb78319ad35aba09c228a` |
| 68 | `20260715024932_88a533a0-250c-4335-b143-bfc04b806040.sql` | 20260715024932 | `15f2aeee3bff64b3a0e71c276839611ee5be5205` | 1066 | `00e3ecb50c5c39d6473a69937157cbabd0e21c76d3bc59f17aeaf5602a3048f7` |
| 69 | `20260715024955_1425a886-41c0-4d1e-8e2f-99626d70c119.sql` | 20260715024955 | `0ed5c8f06c0f1790bf35be9c5a3b33d2671b4556` | 1093 | `5e6664dd813ce2c77fa590d2658967932f694c5c081b3d26feb9654727a1f468` |
| 70 | `20260715025017_3c27256c-6822-4b73-86d6-80f5c07ed162.sql` | 20260715025017 | `9e6004ecbc9b1f76450d4b27a09f68142000d441` | 1518 | `58b0bfac4bd4df7f5ed27a9002823e3596d1957e16ad4ccb064c23047afe71fd` |
| 71 | `20260715025034_64391992-0b73-4ac6-9866-26521e9337fd.sql` | 20260715025034 | `baaf6f9b0472e3080bf4e80a7d1f2253379b7815` | 1187 | `e80889d6a4b70e6c1ceb3fbd7a872be0a293db9ac6dc0fcdbc91bb3d9dbe920e` |
| 72 | `20260715025051_17266975-1d20-4452-98b6-d13c7d2f0428.sql` | 20260715025051 | `03780437b4c8c3c1df971d32111165417939358f` | 1127 | `b381a0007b5fa2a9b8935b02b336d241ca90a70913c9a3e5d1f937ef535cee79` |
| 73 | `20260715025106_1513f6b5-981b-44f9-b745-62e1c621c611.sql` | 20260715025106 | `fc7cb8c698ca73648beb014d213c840579f1970f` | 768 | `b553932f5977f593b4e1a8463f4cc806e0a9fcb497dfecbae98bbae8c9fd4148` |
| 74 | `20260715025126_2fbccfc5-3af0-4cc3-806b-9fcd7c32e542.sql` | 20260715025126 | `aa911d709243f32840aae885f69195a6cb85ba95` | 1180 | `fcbe017b35abcf9c1c48d44caec92e725ffd5838b03ed85db80586330932668b` |
| 75 | `20260715025144_d9873eca-fd27-4f3f-8f40-e95ee7f80c63.sql` | 20260715025144 | `c1a7edd20a4242fb3d4ac1f0382e69631d0d5106` | 1366 | `3c58033120911c7c59d7a6ba1ee3ca62cf10c702ffaa635ae5cfc0fffd25a7c1` |
| 76 | `20260715025201_ffb34072-615e-4233-808d-e6a6533ebf80.sql` | 20260715025201 | `71b8217ba5f846edc1b5977b0cda8bc8f56e54a9` | 1129 | `23dca5cecb808508bf274dfccbd80399e22ce23995264c5f1ea938574de94a2c` |
| 77 | `20260715025217_c782db12-d0cc-4695-a6c5-33bbe88ca7c9.sql` | 20260715025217 | `f5b7eb604dc71463c8cf0e9cf878ccde6c050f2a` | 1059 | `9f2c101a9da95f146825c88627e0d519c449cf125bb11afc32e373f109421ca3` |
| 78 | `20260715050855_29f3042b-5cfa-4c22-97ab-f95147c8fa10.sql` | 20260715050855 | `7d2f756b88d04a879183d6bfefd9768dc13024e2` | 12936 | `25345029a1d2aaf546e7b464c04a30da2ec5c5b5d1e4f27172a056224bbe4353` |
| 79 | `20260715120000_approve_capacity_split_proposal.sql` | 20260715120000 | `88a09ed7544c2ec3aab989838e280ab4439c02a5` | 12937 | `a67428771b567758c5c2ce1f2a3fa2763ed9e93bbf85c0a2523cd0baa3c510db` |
| 80 | `20260715130000_reset_experimental_schedule_data.sql` | 20260715130000 | `12affb0eabc20f90540c6ef1eb21bd1004de79d1` | 14805 | `6f5b7c4fd49a65451649b36f1a7dc902e38d260ea8b46f753f5536aca8c8e02e` |
| 81 | `20260715130100_harden_schedule_room_references.sql` | 20260715130100 | `628e5acd2ba7f31a1180e2b20aa1047895a3df32` | 7945 | `0b656d98f5264c16675c332f78c27bd62ee1524348e4edf1f8f087e531a6444c` |
| 82 | `20260715174047_cd106bf0-5530-4338-a161-60b4dfb2a562.sql` | 20260715174047 | `52387c3a03a6509d11e6ba58b94479a6029475be` | 14804 | `51e96102fa6a9cda3bd074477b69d60523d5042fda22518db03b99b6bbe970c0` |
| 83 | `20260715174141_e93e097f-770a-405f-9249-6a42a0525780.sql` | 20260715174141 | `a43219ffec7c9063aa586814f755e73023b570f9` | 7944 | `6417a97429eb7c5bddba05d97fc04ff2a8ed21f76a68177bb7033079fa36e228` |
| 84 | `20260715200046_73b02870-87e2-460f-83d4-e8ec9d7367d1.sql` | 20260715200046 | `b948112a857a03cc1265c3d7803a315fd9757b44` | 4338 | `7d022657e5dbed0658973bc75a9dc5139474dcf981a1a4f9a9298435c8941f03` |
| 85 | `20260715200138_cfea6f8d-447b-4984-9903-4ab64765feec.sql` | 20260715200138 | `3254167f48f64a6aa578b63a893d1919b0b5f375` | 10557 | `f82be2020e370b5106f189fb98c6a5a057eb0ce4b3478728afb05b125100d2d4` |
| 86 | `20260715200200_harden_course_offering_term_references.sql` | 20260715200200 | `e0d48df095b540f9f3fb96ac88a3673abc3cee33` | 4999 | `NOT_COMPUTED` |
| 87 | `20260715200300_create_isolated_schedule_builder_phase6_uat_fixture.sql` | 20260715200300 | `05f81abc523dca2c1bf0c03a0a87cc596ca7ad19` | 11658 | `368dc025e2e8c8ef06152f2f597eb5819e28258569e8bd7b338fa3d8654ef641` |
| 88 | `20260715200400_cleanup_isolated_schedule_builder_phase6_uat_fixture.sql` | 20260715200400 | `86e035f8098eaad8b52c07443b29e0eaf0b7e0de` | 6053 | `ac5fea02088203d163b4884b77bb2487e69f78bbf139ab34bc15d674c63e99d6` |
| 89 | `20260715200500_remediate_course_offering_term_references.sql` | 20260715200500 | `095482211116c73a448088d8d5255687d66ffdc3` | 23370 | `eb9af5d6c5eb667f79e176c1f3d7c3f0af92fd1ca1b25e41a64e91d35ad1f736` |
| 90 | `20260715200600_harden_course_offering_dependencies.sql` | 20260715200600 | `ea6d7e1d575fe083cf65a21af715889720bca03f` | 14134 | `9cdede68535d27bde89d92a402d4a22ae94488c9636f39488c435ebb63ac1c26` |
| 91 | `20260715205304_3a7b66d6-06be-4f43-a4cb-a2ff7eb60df5.sql` | 20260715205304 | `3197f500297d7e2e736c5ad3128a3ed58c5d5ac7` | 2651 | `c5addc018af057d087c40c507d45a450dbe3a8d4244f98bd42619496acc2760c` |
| 92 | `20260715232815_36ab7284-afa4-4783-b1b1-a3a98b8258cc.sql` | 20260715232815 | `ae3b60f6610f6a410605b62f32f95fe59951c872` | 20658 | `NOT_COMPUTED` |
| 93 | `20260716010051_55d9d589-8bdf-4765-83b1-4d7db7b03fae.sql` | 20260716010051 | `3a5e5ebd649d54cf55019f0472ae584553eaa56c` | 12191 | `87dc044b95586163f70a7efacd19509cb13d6adc79357e78e21acff340498c70` |
| 94 | `20260716025117_c196d985-85f6-4119-9e26-affdbbaadc2a.sql` | 20260716025117 | `d365f53abd6c6b58c9c9443627213a50a1d19f19` | 13857 | `2d13c4d8df1ab6ffcad83a3c6d52d392d3a1e265697e48a35721b7b3b3639964` |
| 95 | `20260716030000_generate_cohort_curriculum.sql` | 20260716030000 | `1115d3d74d64e5282321563143f932329a5a656e` | 11512 | `NOT_COMPUTED` |
| 96 | `20260716054608_72253f2c-00b5-47c3-b945-0eaaddf6e4d2.sql` | 20260716054608 | `e0635e098c9b23231a93e79a79e6fd47b916a5c3` | 9836 | `NOT_COMPUTED` |
| 97 | `20260716233716_73dc0ba0-e4ba-43be-8628-ef2c36564a62.sql` | 20260716233716 | `a30d6e9e7e11d04fc6f715de228aab2d45a95d3b` | 39981 | `NOT_COMPUTED` |
| 98 | `20260717035611_82eaf255-efc0-42b6-b42e-4f34ce1f1817.sql` | 20260717035611 | `d3778a3b753e2b02fea88af6eaa828c02934c52c` | 78164 | `NOT_COMPUTED` |
| 99 | `20260717050000_source_only_harden_cross_college_references.sql` | 20260717050000 | `0cd5705ddb06184c2885734ec57ddf1dcce14b3c` | 10636 | `7444440b399209208945715b3bcf859c0c510f33f5de07162a7617f2ef37ac80` |
| 100 | `20260717093000_schedule_builder_v2_assignment_integration.sql` | 20260717093000 | `921f4ae11a474a1191790878e87bdc7ffe5185c9` | 53450 | `NOT_COMPUTED` |
| 101 | `20260718120000_source_only_atomic_schedule_version_lifecycle.sql` | 20260718120000 | `fa6fa28433a1b4517b16802ebf29dc1034dfa5e9` | 16026 | `8a56ac78fd3302193e0cd7cd13b0086343aec475bb650f2d42ec3894be363fdb` |
| 102 | `20260718180000_import_manifest_contract.sql` | 20260718180000 | `17f3f0c949a59e23de880bb59317b983a1446c8c` | 9472 | `e631f9fd48e4f241bb5d0870dc16a30659f71c6b1209651a604971b886c41c26` |
| 103 | `20260718183000_forward_harden_cohort_curriculum_runtime.sql` | 20260718183000 | `5e9cae84a77a2bad416eab5d7636d68fb0b0e14a` | 6186 | `a5a78d276c2227dce0463e02b1764b5077b8009f9b77d9a3b4ee1034831211e7` |
| 104 | `20260718210000_source_only_atomic_import_job_commit.sql` | 20260718210000 | `75c6ef870d0a66a61f5ae4afd6e1f34b2bcdb562` | 65418 | `NOT_COMPUTED` |
| 105 | `20260718233048_5977eee5-dc5a-46bc-be4f-01975cf36fce.sql` | 20260718233048 | `46b0b28f496982c933c95dba5e182e156e75b6b6` | 9471 | `b3a3cdb7190f6ad5e7b09cfac1adf3024662bca3767fed541617899a316304ac` |
| 106 | `20260720120000_source_only_availability_all_active_days.sql` | 20260720120000 | `df7d7c5a01d6269c1b716298e8d4f932eeb810b0` | 13196 | `NOT_COMPUTED` |
| 107 | `20260720143000_source_only_program_department_integrity.sql` | 20260720143000 | `00632ccf0424f2636f6a4b3d634576d54c345120` | 1683 | `a7c025a85aab63fd99a486f2686cc62a41c8104c1ec3b1257e14423552b9b2b6` |
| 108 | `20260721090000_source_only_legacy_write_hardening.sql` | 20260721090000 | `142d7fd9a398f09c596cf133dc0d5ede9893eb2d` | 4542 | `a5092eef608023c47dff0ef9e6d57ec82cfe409f3173fb30f596936d781517df` |
| 109 | `20260721180000_source_only_scheduling_headcount_foundation.sql` | 20260721180000 | `c559716c3587d2a78f4bc8c9b77f4860f9d73179` | 23638 | `b07a7ef239586204453b3e5816fefd8b6f9f4e319a1fcf20e249200c1832926e` |

## 2. Priority detail rows

### 20260715120000

- **File:** `20260715120000_approve_capacity_split_proposal.sql`
- **Version:** `20260715120000` | **Blob SHA:** `88a09ed7544c2ec3aab989838e280ab4439c02a5` | **Size:** 12937 bytes | **SHA256:** `a67428771b567758c5c2ce1f2a3fa2763ed9e93bbf85c0a2523cd0baa3c510db`
- **Applied status:** NOT APPLIED (confirmed source-only pending)
- **Remote version (supabase_migrations):** UNKNOWN (no database access in this track)
- **Depends on / ordering constraints:** Section-subgroups capacity model migrations 20260715011643 / 20260715012000 and shared lecture group foundation 20260605001512 must already exist remotely.
- **Data prerequisite:** A capacity split proposal pending approval; section_subgroups capacity model in place.
- **Rollback consideration:** No down/reverse migration file exists. Approval is a state transition; reversal would require a new compensating migration approved separately.
- **Verifier:** Migration body contains self-checking logic (DO-block style guards consistent with sibling capacity migrations); external verifier = re-query proposal/approval state after apply.
- **Apply-order position:** Pending set, step 1 of recommended order (after Phase-0 baseline confirmation).

### 20260716070000

- **File:** `(no file with this version prefix exists)`
- **Version:** `20260716070000` | **File:** NOT FOUND in repository
- **Applied status:** NOT FOUND — no migration file `20260716070000_*` exists in supabase/migrations/ at b6a5a491 or at current main HEAD (7d738204). The requested detail row cannot be produced; treat any external reference to this version as UNKNOWN/unverifiable.
- **Remote version (supabase_migrations):** UNKNOWN (no database access in this track)
- **Depends on / ordering constraints:** UNKNOWN
- **Data prerequisite:** UNKNOWN
- **Rollback consideration:** UNKNOWN
- **Verifier:** UNKNOWN
- **Apply-order position:** N/A

### 20260717050000

- **File:** `20260717050000_source_only_harden_cross_college_references.sql`
- **Version:** `20260717050000` | **Blob SHA:** `0cd5705ddb06184c2885734ec57ddf1dcce14b3c` | **Size:** 10636 bytes | **SHA256:** `7444440b399209208945715b3bcf859c0c510f33f5de07162a7617f2ef37ac80`
- **Applied status:** NOT APPLIED (confirmed source-only pending)
- **Remote version (supabase_migrations):** UNKNOWN (no database access in this track)
- **Depends on / ordering constraints:** Baseline schema for academic_cohorts and academic_terms already applied.
- **Data prerequisite:** No duplicate (id, college_id) pairs may exist in academic_cohorts / academic_terms at apply time (composite UNIQUE would fail otherwise).
- **Rollback consideration:** No down file. Reverse = DROP of the added composite UNIQUE constraints / hardened FK references via a new migration.
- **Verifier:** Adds composite UNIQUE(id, college_id) on academic_cohorts + academic_terms and hardens cross-college references; verify via pg_constraint after apply.
- **Apply-order position:** Pending set, step 2 — MUST precede 20260721180000 (headcount foundation depends on the composite UNIQUE).

### 20260718183000

- **File:** `20260718183000_forward_harden_cohort_curriculum_runtime.sql`
- **Version:** `20260718183000` | **Blob SHA:** `5e9cae84a77a2bad416eab5d7636d68fb0b0e14a` | **Size:** 6186 bytes | **SHA256:** `a5a78d276c2227dce0463e02b1764b5077b8009f9b77d9a3b4ee1034831211e7`
- **Applied status:** NOT APPLIED (confirmed source-only pending)
- **Remote version (supabase_migrations):** UNKNOWN (no database access in this track)
- **Depends on / ordering constraints:** Cohort/curriculum runtime tables from the baseline chain.
- **Data prerequisite:** Cohort-curriculum runtime data in expected state; exact data baseline UNKNOWN (no DB access in this track).
- **Rollback consideration:** No down file; forward-hardening constraints would need a compensating migration to relax.
- **Verifier:** Constraint/trigger presence checks via pg_catalog after apply.
- **Apply-order position:** Pending set, step 3.

### 20260720120000

- **File:** `20260720120000_source_only_availability_all_active_days.sql`
- **Version:** `20260720120000` | **Blob SHA:** `df7d7c5a01d6269c1b716298e8d4f932eeb810b0` | **Size:** 13196 bytes | **SHA256:** `NOT_COMPUTED`
- **Applied status:** NOT APPLIED (confirmed source-only pending)
- **Remote version (supabase_migrations):** UNKNOWN (no database access in this track)
- **Depends on / ordering constraints:** Availability/instructor-day baseline tables.
- **Data prerequisite:** UNKNOWN data baseline. NOTE: SHA256 NOT_COMPUTED — fetched content could not be byte-verified against the blob SHA (transcription off by ~2 bytes); re-fetch from git before relying on content-level facts.
- **Rollback consideration:** No down file; UNKNOWN specifics.
- **Verifier:** UNKNOWN (content not byte-verified).
- **Apply-order position:** Pending set, step 4 (independent of the headcount chain; position flexible).

### 20260720143000

- **File:** `20260720143000_source_only_program_department_integrity.sql`
- **Version:** `20260720143000` | **Blob SHA:** `00632ccf0424f2636f6a4b3d634576d54c345120` | **Size:** 1683 bytes | **SHA256:** `a7c025a85aab63fd99a486f2686cc62a41c8104c1ec3b1257e14423552b9b2b6`
- **Applied status:** NOT APPLIED (confirmed source-only pending)
- **Remote version (supabase_migrations):** UNKNOWN (no database access in this track)
- **Depends on / ordering constraints:** Independent (per confirmed facts) — programs/departments baseline only.
- **Data prerequisite:** Program/department reference data in expected state; small file (1683 bytes) consistent with a focused integrity check/constraint.
- **Rollback consideration:** No down file; compensating migration required to reverse.
- **Verifier:** Integrity check passes / constraint present in pg_catalog.
- **Apply-order position:** Pending set, step 5 — apply when need/order confirmed; sits inside headcount chain as: 20260717050000 → 20260720143000 (if confirmed) → 20260721180000.

### 20260721090000

- **File:** `20260721090000_source_only_legacy_write_hardening.sql`
- **Version:** `20260721090000` | **Blob SHA:** `142d7fd9a398f09c596cf133dc0d5ede9893eb2d` | **Size:** 4542 bytes | **SHA256:** `a5092eef608023c47dff0ef9e6d57ec82cfe409f3173fb30f596936d781517df`
- **Applied status:** NOT APPLIED (confirmed source-only pending)
- **Remote version (supabase_migrations):** UNKNOWN (no database access in this track)
- **Depends on / ordering constraints:** STRICT ORDERING: must run after legacy data remediation step A1.3b and before A1.3c (confirmed fact). Applying earlier would harden writes before legacy data is clean; applying later leaves a write-integrity gap.
- **Data prerequisite:** Legacy data remediation A1.3b completed and verified.
- **Rollback consideration:** No down file; hardening (likely triggers/policies) would need explicit compensating migration.
- **Verifier:** Write-path denial tests + trigger/policy presence checks after apply.
- **Apply-order position:** Pending set, step 6 — between remediation steps A1.3b and A1.3c.

### 20260721180000

- **File:** `20260721180000_source_only_scheduling_headcount_foundation.sql`
- **Version:** `20260721180000` | **Blob SHA:** `c559716c3587d2a78f4bc8c9b77f4860f9d73179` | **Size:** 23638 bytes | **SHA256:** `b07a7ef239586204453b3e5816fefd8b6f9f4e319a1fcf20e249200c1832926e`
- **Applied status:** NOT APPLIED (confirmed source-only pending)
- **Remote version (supabase_migrations):** UNKNOWN (no database access in this track)
- **Depends on / ordering constraints:** REQUIRES 20260717050000 applied first: the headcount foundation relies on the composite UNIQUE(id, college_id) on academic_cohorts + academic_terms created there (confirmed fact).
- **Data prerequisite:** 20260717050000 applied; approved headcount data staged for load AFTER this migration; then proceed to remediation phase A2.
- **Rollback consideration:** No down file; foundation objects would need a dedicated teardown migration. Data loaded afterwards (headcount) must be considered in any rollback plan.
- **Verifier:** Foundation objects present (pg_catalog) + post-load headcount row counts reconciled against approved source data.
- **Apply-order position:** Pending set, step 7 — chain: 20260717050000 → 20260720143000 (if confirmed) → 20260721180000 → approved headcount data → A2.

## 3. Shared lecture groups & schedule-version lifecycle migrations (detail set)

| Filename | Version | Blob SHA | Size | SHA256 | Role |
|----------|---------|----------|------|--------|------|
| `20260605001512_5e0e8801-eb18-4186-b505-bfd47296db13.sql` | 20260605001512 | `3813a6ad1734534d507696783c591e63e5998e95` | 16294 | `4998386a0e77423e4c0c63c2c24ffa3c7c3b646be0f9de0bbc1e0fff7da8e572` | Shared lecture groups foundation: creates section_groups + section_group_members (the shared-lecture-group model that capacity splitting and remediation migrations reference). |
| `20260715011643_a67fc9c2-5f77-4d33-a96b-12a63d8e3a71.sql` | 20260715011643 | `1e23d830fdf7f913cf36b031a7e68d4c2281a020` | 5731 | `92c4e20f94a863414d4e8917002aad512ceb060385010eea6e8d7b55b4aa9f5e` | Section-subgroups capacity model (UUID-named twin of 20260715012000; content identical apart from 1 trailing byte). |
| `20260715012000_section_subgroups_capacity_model.sql` | 20260715012000 | `ece834dd7eb66597f968ae47671f6052fc03ca6f` | 5732 | `5ac0e71bea31d6f6ddcf9fbde113e7b736d1e85b001dbc149dd696d33a028438` | Section-subgroups capacity model (named twin of 20260715011643). Prerequisite for the capacity split approval 20260715120000. |
| `20260605013524_3d61d3cc-2c94-4e85-a6bb-78ae3029023f.sql` | 20260605013524 | `6f8fa72bd8e1da04d758922d6f5ba1702e85fbf1` | 10182 | `842b92c205a8d035e7c6bdc121c282c007e2c4435145329431d8e703934cb168` | schedule_versions table — the schedule-version lifecycle state carrier (draft/published/archived family of states). |
| `20260606184852_a88e79bf-b065-4f18-b246-6d11c69756d6.sql` | 20260606184852 | `1241c332a4dbe79abacaa2b745d67770e6e8b3dd` | 3643 | `6ac6b7da30b8458a6c46e7338fb34c05ff40e0156142c4b9182d608ec1db7c67` | Schedule-version lifecycle events (event log supporting lifecycle transitions/audit). |
| `20260709193500_schedule_version_conflict_exceptions.sql` | 20260709193500 | `254450665b9489399572c1730d1d1a3f841c4804` | 5362 | `b0528f29cee6aeb4001772ecd613192f052a63971533c35287ea8ad259329d21` | Creates schedule_version_conflict_exceptions (approved conflict exception registry used by lifecycle gating). |
| `20260709213405_a7ddbff3-f65a-4b45-80d1-6f4e49ae0f1b.sql` | 20260709213405 | `15ca9944195af204f51a60f57c9f240bb71fa423` | 4781 | `f662153560c0b3b1f33cd502c46b13f8a5318c665ec0e468f4016e840d50382d` | Conflict-exception companion migration (UUID-named), same schedule-version conflict-exceptions feature set. |
| `20260709213902_a070c634-dad0-4ff8-b5af-548d1328d135.sql` | 20260709213902 | `4a9d4193c4d9e0a88ca788017dd0ed2a74bd27c3` | 42325 | `NOT_COMPUTED` | Seeds 44 approved conflict exceptions for schedule version 482af19b-0d44-4631-b80a-753f5ead4089 (42 legacy_overlap_inherited instructor/room pairs + 2 room_type_mismatch owner exceptions), with count self-check (c=44) and REVOKE of sandbox_exec INSERT. SHA256 NOT_COMPUTED (transcription 1 byte off; blob SHA authoritative). |
| `20260709213954_0a0f7761-4ee5-43bd-b8e5-7074b2e42256.sql` | 20260709213954 | `3a21d4f98dc5370e8316aeee8c393d84a5770a68` | 3343 | `9da8b570c4d16d19122b73eb01d1d2f6c550a6a54a97a45028cfdc9775022f80` | Conflict-exception companion migration (UUID-named), same feature set. |
| `20260718120000_source_only_atomic_schedule_version_lifecycle.sql` | 20260718120000 | `fa6fa28433a1b4517b16802ebf29dc1034dfa5e9` | 16026 | `8a56ac78fd3302193e0cd7cd13b0086343aec475bb650f2d42ec3894be363fdb` | SOURCE-ONLY (filename marker) atomic schedule_version lifecycle transitions (atomic publish/archive family). NOT in the confirmed NOT-APPLIED set of 7 — remote applied status UNKNOWN; confirm before any apply. |
| `20260718210000_source_only_atomic_import_job_commit.sql` | 20260718210000 | `75c6ef870d0a66a61f5ae4afd6e1f34b2bcdb562` | 65418 | `NOT_COMPUTED` | SOURCE-ONLY (filename marker) atomic import-job commit. NOT in the confirmed NOT-APPLIED set of 7 — remote applied status UNKNOWN; confirm before any apply. SHA256 NOT_COMPUTED (not fetched). |

## 4. Confirmed facts (from launch-closure coordination)

1. **Exactly 7 migrations are confirmed source-only and NOT APPLIED:** `20260715120000`, `20260717050000`, `20260718183000`, `20260720120000`, `20260720143000`, `20260721090000`, `20260721180000`.
2. **Headcount chain dependency (confirmed):** `20260721180000` (scheduling headcount foundation) **requires `20260717050000` applied first** — the composite `UNIQUE(id, college_id)` on `academic_cohorts` + `academic_terms` is created by `20260717050000`.
3. **Strict remediation ordering (confirmed):** `20260721090000` (legacy write hardening) applies **strictly after legacy data remediation step A1.3b and before A1.3c**.
4. **`20260720143000` is independent** (program/department integrity); apply when need/order is confirmed.
5. **Expected headcount-chain apply order:** `20260717050000` → `20260720143000` (if confirmed) → `20260721180000` → approved headcount data load → remediation phase A2.
6. Note: the filename marker `source_only` appears on 7 files, but the sets differ — `20260718120000` and `20260718210000` carry the marker yet are **not** in the confirmed NOT-APPLIED set (remote status UNKNOWN), while confirmed-pending `20260715120000` and `20260718183000` do not carry the marker. Applied status follows the confirmed list, not the filename convention.

## 5. Recommended FULL apply order (every step gated by APPROVE_DB_MIGRATION_APPLY)

- **Phase 0 — Baseline confirmation (gate):** Verify remote migration history (`supabase_migrations.schema_migrations`) matches the 102 non-pending baseline migrations in timestamp (version-prefix) order. Remote state is UNKNOWN from this track; discrepancies halt the plan.
- **Phase 1 — Pending set, in this order (each an individual gate):**
  1. `20260715120000` — approve capacity split proposal (confirm capacity-model migrations `20260715011643`/`20260715012000` present remotely first).
  2. `20260717050000` — harden cross-college references; creates composite UNIQUE required by headcount.
  3. `20260718183000` — forward-harden cohort/curriculum runtime.
  4. `20260720120000` — availability all active days (independent; re-fetch byte-exact content before apply — see UNKNOWNs).
  5. `20260720143000` — program/department integrity (only once need/order confirmed).
  6. `20260721090000` — legacy write hardening — **only after A1.3b, before A1.3c**.
  7. `20260721180000` — scheduling headcount foundation — then load **approved headcount data**, then proceed to **A2**.
- **Phase 1b — Status-unknown source-only files (separate gates, only if Phase 0 shows them NOT APPLIED):** `20260718120000` (atomic schedule-version lifecycle), `20260718210000` (atomic import-job commit). Their remote status is UNKNOWN; do not assume pending.
- **Halt condition:** any gate failure, preflight mismatch, or unexpected remote state stops the sequence; no partial application of the chain.

## 6. UNKNOWNs and limitations

- **Remote applied status / remote versions:** UNKNOWN for all migrations except the 7 confirmed NOT APPLIED (no database access in this track).
- **SHA256 NOT_COMPUTED (12 files)** — blob SHA1 + size remain authoritative for identity; content-level facts for these files were not used:
- `20260709213902_a070c634-dad0-4ff8-b5af-548d1328d135.sql` (blob SHA `4a9d4193c4d9e0a88ca788017dd0ed2a74bd27c3`, 42325 bytes)
- `20260714010000_schedule_session_move_rpc.sql` (blob SHA `6364b8b147b494dc801278674a3975c57ae79102`, 33807 bytes)
- `20260714012008_a6bb4288-ac48-4681-ad6e-634cf572e904.sql` (blob SHA `5402eab7c0c2562673275a582cead75ca1bf91e1`, 33803 bytes)
- `20260715200200_harden_course_offering_term_references.sql` (blob SHA `e0d48df095b540f9f3fb96ac88a3673abc3cee33`, 4999 bytes)
- `20260715232815_36ab7284-afa4-4783-b1b1-a3a98b8258cc.sql` (blob SHA `ae3b60f6610f6a410605b62f32f95fe59951c872`, 20658 bytes)
- `20260716030000_generate_cohort_curriculum.sql` (blob SHA `1115d3d74d64e5282321563143f932329a5a656e`, 11512 bytes)
- `20260716054608_72253f2c-00b5-47c3-b945-0eaaddf6e4d2.sql` (blob SHA `e0635e098c9b23231a93e79a79e6fd47b916a5c3`, 9836 bytes)
- `20260716233716_73dc0ba0-e4ba-43be-8628-ef2c36564a62.sql` (blob SHA `a30d6e9e7e11d04fc6f715de228aab2d45a95d3b`, 39981 bytes)
- `20260717035611_82eaf255-efc0-42b6-b42e-4f34ce1f1817.sql` (blob SHA `d3778a3b753e2b02fea88af6eaa828c02934c52c`, 78164 bytes)
- `20260717093000_schedule_builder_v2_assignment_integration.sql` (blob SHA `921f4ae11a474a1191790878e87bdc7ffe5185c9`, 53450 bytes)
- `20260718210000_source_only_atomic_import_job_commit.sql` (blob SHA `75c6ef870d0a66a61f5ae4afd6e1f34b2bcdb562`, 65418 bytes)
- `20260720120000_source_only_availability_all_active_days.sql` (blob SHA `df7d7c5a01d6269c1b716298e8d4f932eeb810b0`, 13196 bytes)
  - Special notes: `20260715200200` contains cp1252-mojibake (double-encoded Arabic) in the original, preventing byte-exact reconstruction; `20260709213902` and `20260720120000` transcriptions were off by ~1–2 bytes and were abandoned per scope decision — re-fetch from git if content-level verification is required.
- **`20260716070000`: NOT FOUND** — no such file exists in `supabase/migrations/` at the source ref or current main.
- **Rollback:** no down/reverse migration files exist in the directory; rollback strategy per migration is UNKNOWN unless the file itself is transactional/self-verifying (several remediation migrations use explicit `BEGIN…COMMIT` with `RAISE`-based rollback and audit_logs trails).
- **Twin files:** several near-identical 1-byte-difference twin blobs exist (e.g., `20260715011643`/`20260715012000`, and a `202607150246xx–0252xx` series mirroring `ss_*` files); they are distinct blobs with distinct versions and are listed individually above.

## 7. Safety statement

This matrix is a **review-only reconciliation artifact**. No migration was applied, no database was accessed or modified, and no schema or data was changed in producing it. Nothing herein authorizes application of any migration; every apply step in Section 5 is conditional on an explicit `APPROVE_DB_MIGRATION_APPLY` gate approval by the authorized operator.
