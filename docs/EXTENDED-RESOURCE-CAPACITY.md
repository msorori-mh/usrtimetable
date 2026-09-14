# Extended-day resource capacity certificate

The resource preflight is a necessary upper bound, independent of the search grid, teacher placement and attendance-day target. It does not authorize relaxing the extended-day policy.

Assumptions checked before issuing the certificate:

- The policy permits at most one extended day per actual student partition.
- Every session lasts at least as long as the extension window. Hence two late sessions for the same student cannot fit on one day, even with minute offsets.
- Student membership is complete. No cohort fallback or truncated enumeration is used.
- Rooms incompatible by type or insufficient capacity cannot host a hall-only session. Availability, closures and locks are ignored in this upper bound, which generously increases available capacity.

For each cohort, a bitmask dynamic program enumerates disjoint student sets and retains the greatest total late-session count for each hall-only late-session count. Convolving the cohort frontiers gives the exact upper bound for this relaxed resource problem. Cohorts larger than 12 partitions skip the certificate and continue ordinary search.

Observed draft on 2026-09-14:

| Quantity                                                       |                     Value |
| -------------------------------------------------------------- | ------------------------: |
| Sessions / teaching hours                                      |                 376 / 820 |
| Active lecture halls / labs                                    |                    14 / 6 |
| Working days                                                   |                         6 |
| Normal / extended windows                                      | 08:00–14:00 / 14:00–16:00 |
| Maximum normal room-hours                                      |                       720 |
| Hall-only teaching hours / normal hall-hours                   |                 560 / 504 |
| Required hall-only late sessions                               |                        28 |
| Required total late sessions                                   |                        50 |
| Maximum total late sessions while meeting the hall requirement |                        46 |

A complete schedule would require at least 50 late sessions but can select at most 46. Therefore the unchanged input is infeasible under the policy even with all six weekdays; switching from three to four or five attendance days cannot fix this obstruction.

The conditional capacity gap is 8 hours while retaining the full hall-only requirement. **It is not a lower bound of 8 additional room-hours, nor a claim that exactly 8 hours must be dropped.** Changing normal hall capacity also changes the required late-session counts. For example, 4 additional normal hall-hours per week remove this particular aggregate obstruction; that does not prove the full timetable feasible. A separate relaxed calculation permits the aggregate requirements with at least two partitions receiving a second extended day; full placement may require more. Neither option is applied automatically.

The same preflight runs before generation and before redistribution, including zero-budget searches. UI results distinguish this proof from a timeout. No schedule rows are changed when the certificate is returned.
