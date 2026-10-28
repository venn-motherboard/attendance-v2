-- Edit the values, then run in the SQL editor. Run each numbered block on its own.

-- 1) Subject and section
insert into subjects (code, name) values ('IT101', 'Intro to Computing');
insert into class_sections (name, academic_term, course) values ('BSIT-1A', '2026-1st', 'BS Information Technology');

-- 2) Teacher: first create the user in Authentication > Users (email + password), copy the UUID, then:
insert into profiles (id, role, full_name) values ('TEACHER-UUID', 'teacher', 'Teacher Name');

-- 3) Assign the teacher to the class
insert into teacher_assignments (teacher_id, subject_id, section_id)
select 'TEACHER-UUID', s.id, c.id from subjects s, class_sections c where s.code = 'IT101' and c.name = 'BSIT-1A';

-- 4) Enroll a student (create the student in the Admin page first)
insert into class_enrollments (student_user_id, subject_id, section_id)
select sp.user_id, s.id, c.id from student_profiles sp, subjects s, class_sections c
where sp.student_id = 'STUDENT-ID' and s.code = 'IT101' and c.name = 'BSIT-1A';
