from services.auth import (
    hash_value,
    verify_value,
    generate_user_id,
    generate_session_token
)


def test_hash_value_produces_different_output_than_input():

    hashed = hash_value("my_password")

    assert hashed != "my_password"
    assert len(hashed) > 0


def test_verify_value_succeeds_for_correct_value():

    hashed = hash_value("my_password")

    assert verify_value("my_password", hashed) is True


def test_verify_value_fails_for_incorrect_value():

    hashed = hash_value("my_password")

    assert verify_value("wrong_password", hashed) is False


def test_hash_value_produces_different_hash_each_time():

    hash_one = hash_value("same_input")
    hash_two = hash_value("same_input")

    assert hash_one != hash_two

    assert verify_value("same_input", hash_one) is True
    assert verify_value("same_input", hash_two) is True


def test_generate_user_id_has_expected_prefix():

    user_id = generate_user_id()

    assert user_id.startswith("user_")
    assert len(user_id) > len("user_")


def test_generate_user_id_is_unique():

    first_id = generate_user_id()
    second_id = generate_user_id()

    assert first_id != second_id


def test_generate_session_token_is_unique():

    first_token = generate_session_token()
    second_token = generate_session_token()

    assert first_token != second_token
    assert len(first_token) > 20